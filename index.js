#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var os = require('os');
var { exec } = require('child_process');
var republish = require('./lib/republish');

// setup
var registry = 'https://registry.npmjs.org/'
var localIPFSgateway = 'http://localhost:8080/'
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-npm-republish-'));
// should probably empty tmp dir first

// if no args

republish.republishDependenciesFromDisk(registry, tmpDir, localIPFSgateway)

// otherwise first arg is package name

// download packument for package name
// add
