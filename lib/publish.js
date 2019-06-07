var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var republish = require('./republish');
var RemoteLS = require('./remote-ls');
var async = require('async');

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
        'dist-tags': {}
      }

      // generate tarball (npm pack)
      exec('cd ' + tmpDir + ' && npm pack --json ' + process.cwd(), (err, stdout, stderr) => {
        if (err) {
          console.log(`stderr: ${stderr}`);
          return;
        }
        versions = JSON.parse(stdout)

        var tarballPath = tmpDir+'/'+versions[0].filename

        exec('ipfs add --cid-version 1 --quiet '+tarballPath, (err, stdout, stderr) => {
          if (err) {
            console.log(`stderr: ${stderr}`);
            return;
          }

          var tarballCid = stdout.trim()

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

          // write packument to root
          fs.writeFile(tmpDir+'/'+name, JSON.stringify(packument), (err) => {
            if (err) console.log(err);

            // resolve full dependency tree
            publish.resolveDependencies(packageJson.dependencies, function(packages) {

              var q = async.queue(function(package, resolve) {
                var packageName = package.split('@')[0]
                var version = package.split('@')[1]
                var tarballURL = registry + packageName +'/-/'+packageName+'-'+version+'.tgz'
                republish.processDependency(packageName, {version: version, resolved: tarballURL}, registry, tmpDir, localIPFSgateway, resolve)
              }, 1);


              q.drain = function() {
                republish.republishMicroRegistry(tmpDir, localIPFSgateway, false, function(newRegistryUrl) {
                  console.log('\nPublished '+ name +'@'+version +': ' + newRegistryUrl)
                  console.log('\nUse it with the following command')
                  console.log('\n  $ npm install '+name +'@'+version+' --registry=' + newRegistryUrl + '\n')
                })
              };

              packages.map(function(package, index) {
                q.push(package);
              })
            })
          });
        });

      })
    }
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
  }
}
module.exports = publish;
