var https = require('https');
var fs = require('fs');
var path = require('path');
var { exec } = require('child_process');

var republish = {
  processDependency: function(key, value, registry, tmpDir, localIPFSgateway, cb) {
    // console.log(value)
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
    });
  },

  loadPackument: function(name, registry, cb) {
    var url = registry + name
    https.get(url, res => {
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
    var request = https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(cb);  // close() is async, call cb after close completes.
      });
    });
  },

  republishMicroRegistry: function(tmpDir, localIPFSgateway) {
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

        exec('npm config set registry ' + newRegistryUrl + ' --userconfig ./.npmrc', function (err, stdout, stderr) {
          if (err) {
            console.log(`stderr: ${stderr}`);
            return;
          }

          console.log('\nNew registry url: ' + newRegistryUrl)
          console.log('\nUse it with the following command')
          console.log('\n  $ npm install --registry=' + newRegistryUrl + '\n')
        })
      })
    })
  },

  republishDependenciesFromDisk: function(registry, tmpDir, localIPFSgateway) {
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
      republish.republishMicroRegistry(tmpDir, localIPFSgateway)
    });
  }
}
module.exports = republish;
