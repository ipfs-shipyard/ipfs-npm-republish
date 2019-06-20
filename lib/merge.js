var deepmerge = require('deepmerge');
var fs = require('fs');
var path = require('path');
var os = require('os');
var async = require('async');
var crypto = require('crypto');
var { exec } = require('child_process');
var republish = require('./republish')

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-publish-'));

var merge = {
  merge: function(registry_1_cid, registry_2_cid, localIPFSgateway){

    // ipfs get registry 1 into tmp dir
    exec('ipfs get -o='+tmpDir+' ' + registry_1_cid, (err, stdout, stderr) => {

      // make second tmp dir
      var tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-publish-2-'));

      // ipfs get registry 2 into tmp dir
      exec('ipfs get -o='+tmpDir2+' ' + registry_2_cid, (err, stdout, stderr) => {

        // copy and merge files from registry 1 to registry 2
        var filenames = fs.readdirSync(tmpDir)
        async.each(filenames, function(filename, cb){
          merge.copyFile(filename, tmpDir, tmpDir2, cb)
        },
        function(err){
          republish.republishMicroRegistry(tmpDir2, localIPFSgateway, true, function(newRegistryUrl) {
            console.log('\nNew registry url: ' + newRegistryUrl)
          })
        });
      })
    })
  },

  copyFile: function(filename, source, destination, callback){
    if(fs.existsSync(destination + '/' + filename)){
      merge.hashFile(destination + '/' + filename, function(hash1) {
        merge.hashFile(source + '/' + filename, function(hash2) {
          var identical = (hash1.digest('hex') == hash2.digest('hex'))

          if(filename.match(/\.tgz$/)){
            if(!identical){
              throw 'OH NO, clashing tarballs'
            }
            callback()
          } else {
            if(identical){
              fs.rename(source + '/' + filename, destination + '/' + filename, callback)
            } else {
              var packument1 = JSON.parse(fs.readFileSync(source + '/' + filename, 'utf8'));
              var packument2 = JSON.parse(fs.readFileSync(destination + '/' + filename, 'utf8'));
              var newPackument = deepmerge(packument1, packument2)
              fs.writeFile(destination + '/' + filename, JSON.stringify(newPackument), callback)
            }
          }
        })
      })
    } else {
      fs.rename(source + '/' + filename, destination + '/' + filename, callback)
    }
  },
  hashFile: function(path, cb){
    data = fs.readFileSync(path);
    var hash = crypto.createHash('sha256').update(data);
    cb(hash)
  }
}

module.exports = merge;
