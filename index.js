#!/usr/bin/env node

var republish = require('./lib/republish');
var publish = require('./lib/publish');

// setup
var registry = 'https://registry.npmjs.org/'
var localIPFSgateway = 'http://localhost:8080/'

var args = process.argv.slice(2)

if (args.length === 0){
  republish.republishDependenciesFromDisk(registry, localIPFSgateway)
} else if (args[0] == 'publish') {
  publish.publish(args[1], registry, localIPFSgateway)
} else {
  republish.republishPackage(args[0], registry, localIPFSgateway)
}
