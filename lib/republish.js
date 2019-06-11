var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var RemoteLS = require('./remote-ls');
var async = require('async');
var pacote = require('pacote')

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-republish-'));

var concurrency = 8;

var republish = {
  processDependency: function(name, data, registry, tmpDir, localIPFSgateway, cb) {
    if (data.version.indexOf("github") == 0){
      console.log('  Skipping github dependency for '+name+'@'+data.version)
      cb()
      return
    }

    // fetch packument
    republish.loadPackument(name, registry, function(packument) {
      var tarballPath = tmpDir+'/'+name+'-'+data.version+'.tgz'

      const matchScoped = name.match(/^(@[^\/]+)\//)
      if (matchScoped) {
        const scopeDir = path.join(tmpDir, matchScoped[1])
        if (!fs.existsSync(scopeDir)) {
          fs.mkdirSync(scopeDir)
        }
      }

      republish.addTarballIPFS(name, data, tarballPath, packument, localIPFSgateway, tmpDir, cb)
    });
  },

  addTarballIPFS: function(name, data, tarballPath, packument, localIPFSgateway, tmpDir, cb) {
    var integrity = packument.versions[data.version].dist.integrity
    // TODO fall back to sha1 shasum if integrity field not present

    var resolved = data.resolved

    pacote.tarball.toFile(name+'@'+data.version, tarballPath, {integrity: integrity, resolved: resolved, cache: require('os').homedir() + '/.npm/_cacache'}).then(() => {

      // ipfs add tarball
      exec('ipfs add --cid-version 1 --quiet '+tarballPath, (err, stdout, stderr) => {
        if (err) {
          console.log(`stderr: ${stderr}`);
          return;
        }

        var tarballCid = stdout.trim()

        var packumentPath = tmpDir+'/'+name

        // rewrite the dist.tarball url to a local gateway url with tarball hash
        var packumentVersion = packument.versions[data.version]
        packumentVersion.dist.tarball = localIPFSgateway + 'ipfs/' + tarballCid

        // check to see if there is an existing packument
        if (fs.existsSync(packumentPath)){
          var existingPackument = JSON.parse(fs.readFileSync(packumentPath, 'utf8'));
          var newPackument = existingPackument
          newPackument.versions[data.version] = packumentVersion

        } else {
          var versions = {}
          versions[data.version] = packumentVersion
          var newPackument = Object.assign({}, packument)
          newPackument.versions = versions
        }

        // write packument to root
        fs.writeFile(packumentPath, JSON.stringify(newPackument), (err) => {
          if (err) console.log(err);
          console.log('  Added ' + name + '@' + data.version)
          cb();
        });
      });
    });
  },

  loadPackument: function(name, registry, cb) {
    pacote.packument(name, {cache: require('os').homedir() + '/.npm/_cacache', "prefer-offline": true}).then((m) => cb(m))
  },

  republishMicroRegistry: function(tmpDir, localIPFSgateway, setRegistry, cb) {
    exec('ipfs add --cid-version 1 --quiet --pin=true -r '+tmpDir, function (err, stdout, stderr) {
      if (err) {
        console.log(`stderr: ${stderr}`);
        return;
      }
      var cids = stdout.trim().split("\n")

      var dirCid = cids[cids.length-1]

      var newRegistryUrl = localIPFSgateway + 'ipfs/' + dirCid
      if(setRegistry){
        exec('npm config set registry ' + newRegistryUrl + ' --userconfig ./.npmrc', function (err, stdout, stderr) {
          if (err) {
            console.log(`stderr: ${stderr}`);
            return;
          }
          cb(newRegistryUrl)
        })
      } else {
        cb(newRegistryUrl)
      }
    })
  },

  republishDependenciesFromDisk: function(registry, localIPFSgateway) {
    // read package-lock.json
    var packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

    // find dependencies
    var dependencies = republish.findDependencies([], packageLock)

    console.log("Processing " + dependencies.length + " packages\n ")


    var q = async.queue(function(dep, resolve) {
      republish.processDependency(dep.name, dep, registry, tmpDir, localIPFSgateway, resolve)
    }, concurrency);


    q.drain = function() {
      republish.republishMicroRegistry(tmpDir, localIPFSgateway, true, function(newRegistryUrl) {
        console.log('\nNew registry url: ' + newRegistryUrl)
        console.log('\nUse it with the following command')
        console.log('\n  $ npm install --registry=' + newRegistryUrl + '\n')
      })
    };

    dependencies.map(function(dep, index) {
      q.push(dep);
    })
  },

  resolveDependencies: function(dependencies, cb) {
    var ls = new RemoteLS({development: false, flatten: true})

    Object.keys(dependencies).forEach(function (name) {
      ls.queue.push({
        name: name,
        version: dependencies[name],
        parent: ls.tree
      })
    })

    ls.queue.drain = function () {
      cb(Object.keys(ls.flat))
    }

    ls.queue.resume()
  },

  republishPackage: function(package, registry, localIPFSgateway) {
    if (package[0] === '@') {
      var packageName = '@' + package.split('@')[1]
      var version = package.split('@')[2] || 'latest'
    } else {
      var packageName = package.split('@')[0]
      var version = package.split('@')[1] || 'latest'
    }

    var dependencies = {}
    dependencies[packageName] = version
    republish.resolveDependencies(dependencies, function(packages) {

      var q = async.queue(function(package, resolve) {

        if (package[0] === '@') {
          var packageName = '@' + package.split('@')[1]
          var version = package.split('@')[2] || 'latest'
        } else {
          var packageName = package.split('@')[0]
          var version = package.split('@')[1] || 'latest'
        }
        var tarballURL = registry + packageName +'/-/'+packageName+'-'+version+'.tgz'
        republish.processDependency(packageName, {version: version, resolved: tarballURL}, registry, tmpDir, localIPFSgateway, resolve)
      }, concurrency);


      q.drain = function() {
        republish.republishMicroRegistry(tmpDir, localIPFSgateway, false, function(newRegistryUrl) {
          console.log('\nNew registry url: ' + newRegistryUrl)
          console.log('\nUse it with the following command')
          console.log('\n  $ npm install '+packageName+ '@' + version + ' --registry=' + newRegistryUrl + '\n')
        })
      };

      packages.map(function(package, index) {
        q.push(package);
      })

    });
  },

  findDependencies: function(allDependencies, dep) {
    var dependencies = dep.dependencies
    Object.keys(dependencies).map(function(name, index) {
      var dep = dependencies[name]
      dep.name = name
      allDependencies.push(dep)
      if(dep.dependencies !== undefined) {
        republish.findDependencies(allDependencies, dep)
      }
    })
    return allDependencies
  }
}
module.exports = republish;
