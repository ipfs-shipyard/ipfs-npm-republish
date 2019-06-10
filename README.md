# ipfs-npm-republish

Republish your node project's dependencies to IPFS as a micro-registry

## Install

```shell
npm install -g ipfs-npm-republish
```

You also need IPFS running, I recommend installing [IPFS Desktop](https://github.com/ipfs-shipyard/ipfs-desktop).

## Usage

To republish all the dependencies for your application, run the following command within folder with a package-lock.json present:

```shell
ipfs-npm-republish
```

To republish a specific module from npm along with it's dependencies to ipfs, run the following command passing the name of the package:

```shell
ipfs-npm-republish react
```

adding a version string also works:

```shell
ipfs-npm-republish react@16.8.6
```

You can also publish a new package directly to IPFS without needing to first publish to npmjs.org, run the following command within folder with a package.json present:

```shell
ipfs-npm-republish publish
```

To publish a second release to an existing package that was published to IPFS, you can pass the hash of the previous version of the registry:

```shell
ipfs-npm-republish publish bafybeiahqsziz6mxofxlvx3baqcrihjicxoh27mcg4eukwybvb2u7whuzm
```

## How it works
```
1. List dependencies for current directory from package-lock.json
2. Calculate list of packages to be republished
3. create an folder to act as ROOT
4. For each package
  1. Fetch packuments for each package and write to ROOT
  2. For each depended upon version:
    1. download the tarball to ROOT
    2. ipfs add tarball
    3. rewrite the dist.tarball url to a local gateway url with tarball hash
5. ipfs add -r ROOT
7. set per-project npm config to use new micro-registry
8. output command to update registry to point to ipfs ROOT hash
```
## TODOS

- respect .npmrc for registry configs
- Publish ROOT to ipns (optional due to speed issues)
- Don't upload private modules
- support git dependencies
- check that IPFS is running locally
- check that you have a package-lock.json
- tests!

## Making it work offline

- Use locally cached packuments (`.npm/_cacache/index-v5` which then points to `.npm/_cacache/content-v2`, not sure what the cache key for requests is yet)

## License

MIT
