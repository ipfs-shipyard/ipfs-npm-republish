var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var republish = require('./republish');
var RemoteLS = require('npm-remote-ls')

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-publish-'));

var publish = {
  publish: function(existing_registry_cid, registry, localIPFSgateway){
    if (existing_registry_cid){
      // update existing package
      console.log('update existing package', existing_registry_cid)
    } else {
      // new package

      // read package.json
      var packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

      var name = packageJson.name
      var version = packageJson.version

      // make new packument
      packument = {
        versions: {},
        name: name,
        'dist-tags': {},
        modified: new Date().toISOString()
      }

      // generate tarball (npm pack)
      exec('cd ' + tmpDir + ' && npm pack --json ' + process.cwd(), (err, stdout, stderr) => {
        if (err) {
          console.log(`stderr: ${stderr}`);
          return;
        }
        versions = JSON.parse(stdout)

        var tarballPath = tmpDir+'/'+versions[0].filename

        exec('ipfs add --quiet '+tarballPath, (err, stdout, stderr) => {
          if (err) {
            console.log(`stderr: ${stderr}`);
            return;
          }

          var tarballCid = stdout

          // add first version to packument
          packument.versions[version] = {
            name: name,
            version: version,
            directories: packageJson.directories,
            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
            optionalDependencies: packageJson.optionalDependencies,
            peerDependencies: packageJson.peerDependencies,
            dist: {
              integrity: versions[0].integrity,
              shasum: versions[0].shasum,
              tarball: localIPFSgateway + 'ipfs/' + tarballCid
            }
          }
          packument.modified = new Date().toISOString()

          // write packument to root
          fs.writeFile(tmpDir+'/'+name, JSON.stringify(packument), (err) => {
            if (err) console.log(err);

            // resolve full dependency tree
            publish.resolveDependencies(packageJson.dependencies, function(packages) {
              var packuments = packages.map(function(package, index) {
                return new Promise((resolve) => {

                  var packageName = package.split('@')[0]
                  var version = package.split('@')[1]
                  var tarballURL = registry + packageName +'/-/'+packageName+'-'+version+'.tgz'
                  // fetch packument and tarball
                  republish.processDependency(packageName, {version: version, resolved: tarballURL}, registry, tmpDir, localIPFSgateway, resolve)
                });
              });

              Promise.all(packuments).then(function() {
                // publish to IPFS
                republish.republishMicroRegistry(tmpDir, localIPFSgateway, false, function(newRegistryUrl) {
                  console.log('\nPublished '+ name +'@'+version +': ' + newRegistryUrl)
                  console.log('\nUse it with the following command')
                  console.log('\n  $ npm install '+name +'@'+version+' --registry=' + newRegistryUrl + '\n')
                })
              });
            })
          });
        });

      })
    }
  },

  resolveDependencies: function(dependencies, cb) {
    var ls = new RemoteLS.RemoteLS({development: false, flatten: true})

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
  }
}
module.exports = publish;
