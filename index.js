#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var os = require('os');
var https = require('https');
var { exec } = require('child_process');

var registry = 'https://registry.npmjs.org/'
var localIPFSgateway = 'http://localhost:8080/'

// read package-lock.json
var packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

// find dependencies
var dependencies = packageLock.dependencies

console.log("Processing " + Object.keys(dependencies).length + " packages\n ")

// create a folder to act as ROOT
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-republish-'));

// download and add all the packages
var packuments = Object.keys(dependencies).map(function(key, index) {
  return new Promise((resolve) => {
    processDependency(key, dependencies[key], resolve)
  });
});

Promise.all(packuments).then(function() {
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
});

function processDependency(key, value, cb) {
  // console.log(value)
  if (value.version.indexOf("github") == 0){
    console.log('  Skipping github dependency for '+key+'@'+value.version)
    cb()
    return
  }
  // fetch packument
  loadPackument(key, registry, function(packument) {
    var tarball = tmpDir+'/'+key+'-'+value.version+'.tgz'

    // download the tarball to ROOT
    downloadTarball(value.resolved, tarball, function() {
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
}

function loadPackument(name, registry, cb) {
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
}

var downloadTarball = function(url, dest, cb) {
  var file = fs.createWriteStream(dest);
  var request = https.get(url, function(response) {
    response.pipe(file);
    file.on('finish', function() {
      file.close(cb);  // close() is async, call cb after close completes.
    });
  });
}
