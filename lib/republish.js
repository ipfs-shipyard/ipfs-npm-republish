var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var RemoteLS = require('./remote-ls');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-republish-'));

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

    // download the tarball to ROOT
    republish.downloadTarball(data.resolved, tarballPath, function() {
      // ipfs add tarball
      exec('ipfs add --cid-base=base32 --quiet '+tarballPath, (err, stdout, stderr) => {
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
          packument = existingPackument
          packument.versions[data.version] = packumentVersion

        } else {
          var versions = {}
          versions[data.version] = packumentVersion

          packument.versions = versions
        }

        // write packument to root
        fs.writeFile(packumentPath, JSON.stringify(packument), (err) => {
          if (err) console.log(err);
          console.log('  Added ' + name + '@' + data.version)
          cb();
        });
      });
    });
  },

  loadPackument: function(name, registry, cb) {
    var url = registry + name

    var parsedURL = new URL(url)
    var protocol = (parsedURL.protocol == 'https:' ? https : http);
    var request = protocol.get(url, {headers: {accept: 'application/vnd.npm.install-v1+json'}}, function(res) {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", data => {
        body += data;
      });
      res.on("end", () => {
        body = JSON.parse(body);
        cb(body)
      });
    });
  },

  downloadTarball: function(url, dest, cb) {
    var file = fs.createWriteStream(dest);
    var parsedURL = new URL(url)
    var protocol = (parsedURL.protocol == 'https:' ? https : http);
    var request = protocol.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(cb);  // close() is async, call cb after close completes.
      });
    });
  },

  republishMicroRegistry: function(tmpDir, localIPFSgateway, setRegistry, cb) {
    exec('ipfs add --cid-base=base32 --quiet --pin=true -r '+tmpDir, function (err, stdout, stderr) {
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

    // download and add all the packages
    var packuments = dependencies.map(function(dep, index) {
      return new Promise((resolve) => {
        republish.processDependency(dep.name, dep, registry, tmpDir, localIPFSgateway, resolve)
      });
    });

    Promise.all(packuments).then(function() {
      republish.republishMicroRegistry(tmpDir, localIPFSgateway, true, function(newRegistryUrl) {
        console.log('\nNew registry url: ' + newRegistryUrl)
        console.log('\nUse it with the following command')
        console.log('\n  $ npm install --registry=' + newRegistryUrl + '\n')
      })
    });
  },

  listDependencies: function(name, version, cb) {
    var ls = new RemoteLS({development: false})

    ls.ls(name, version, function () {
      cb(Object.keys(ls.flat))
    })
  },

  republishPackage: function(package, registry, localIPFSgateway) {
    if (package[0] === '@') {
      var packageName = '@' + package.split('@')[1]
      var version = package.split('@')[2] || 'latest'
    } else {
      var packageName = package.split('@')[0]
      var version = package.split('@')[1] || 'latest'
    }

    republish.listDependencies(packageName, version, function(packages) {

      var packuments = packages.map(function(package, index) {
        return new Promise((resolve) => {

          if (package[0] === '@') {
            var packageName = '@' + package.split('@')[1]
            var version = package.split('@')[2] || 'latest'
          } else {
            var packageName = package.split('@')[0]
            var version = package.split('@')[1] || 'latest'
          }
          var tarballURL = registry + packageName +'/-/'+packageName+'-'+version+'.tgz'
          republish.processDependency(packageName, {version: version, resolved: tarballURL}, registry, tmpDir, localIPFSgateway, resolve)
        });
      });

      Promise.all(packuments).then(function() {
        republish.republishMicroRegistry(tmpDir, localIPFSgateway, false, function(newRegistryUrl) {
          console.log('\nNew registry url: ' + newRegistryUrl)
          console.log('\nUse it with the following command')
          console.log('\n  $ npm install '+packageName+ '@' + version + ' --registry=' + newRegistryUrl + '\n')
        })
      });

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
