var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var RemoteLS = require('./remote-ls');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-republish-'));

var republish = {
  processDependency: function(key, value, registry, tmpDir, localIPFSgateway, cb) {
    if (value.version.indexOf("github") == 0){
      console.log('  Skipping github dependency for '+key+'@'+value.version)
      cb()
      return
    }
    // fetch packument
    republish.loadPackument(key, registry, function(packument) {
      var tarball = tmpDir+'/'+key+'-'+value.version+'.tgz'

      const matchScoped = key.match(/^(@[^\/]+)\//)
      if (matchScoped) {
        const scopeDir = path.join(tmpDir, matchScoped[1])
        if (!fs.existsSync(scopeDir)) {
          fs.mkdirSync(scopeDir)
        }
      }

      republish.addTarballIPFS(key, value, tarball, packument, localIPFSgateway, tmpDir, cb)
    });
  },

  addTarballIPFS: function(key, value, tarball, packument, localIPFSgateway, tmpDir, cb) {

    // download the tarball to ROOT
    republish.downloadTarball(value.resolved, tarball, function() {
      // ipfs add tarball
      exec('ipfs add --quiet '+tarball, (err, stdout, stderr) => {
        if (err) {
          console.log(`stderr: ${stderr}`);
          return;
        }

        var tarballCid = stdout

        // rewrite the dist.tarball url to a local gateway url with tarball hash
        packument.versions[value.version].dist.tarball = localIPFSgateway + 'ipfs/' + tarballCid

        // write packument to root
        fs.writeFile(tmpDir+'/'+key, JSON.stringify(packument), (err) => {
          if (err) console.log(err);
          console.log('  Added '+key)
          cb();
        });
      });
    });
  },

  loadPackument: function(name, registry, cb) {
    var url = registry + name

    var parsedURL = new URL(url)
    var protocol = (parsedURL.protocol == 'https:' ? https : http);
    var request = protocol.get(url, function(res) {
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
    exec('ipfs add --quiet  -r '+tmpDir, function (err, stdout, stderr) {
      if (err) {
        console.log(`stderr: ${stderr}`);
        return;
      }
      var cids = stdout.trim().split("\n")

      var dirCid = cids[cids.length-1]

      // pin the directory
      exec('ipfs pin add ' + dirCid, function (err, stdout, stderr) {
        if (err) {
          console.log(`stderr: ${stderr}`);
          return;
        }

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
    })
  },

  republishDependenciesFromDisk: function(registry, localIPFSgateway) {
    // read package-lock.json
    var packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

    // find dependencies
    var dependencies = packageLock.dependencies

    console.log("Processing " + Object.keys(dependencies).length + " packages\n ")

    // download and add all the packages
    var packuments = Object.keys(dependencies).map(function(key, index) {
      return new Promise((resolve) => {
        republish.processDependency(key, dependencies[key], registry, tmpDir, localIPFSgateway, resolve)
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
    var ls = new RemoteLS()

    ls.ls(name, version, function () {
      cb(Object.keys(ls.flat))
    })
  },

  republishPackage: function(package, registry, localIPFSgateway) {
    var packageName = package.split('@')[0]
    var version = package.split('@')[1] || 'latest'


    republish.listDependencies(packageName, version, function(packages) {

      var packuments = packages.map(function(package, index) {
        return new Promise((resolve) => {

          var packageName = package.split('@')[0]
          var version = package.split('@')[1]
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
  }
}
module.exports = republish;
