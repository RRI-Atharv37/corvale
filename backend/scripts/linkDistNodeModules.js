// tsc compiles backend/ + shared/src/ into dist/backend/ + dist/shared/ (see tsconfig.json's
// outDir/rootDir), which puts dist/backend/src/server.js *outside* backend/'s own directory tree.
// Node's require() only walks up from the executing file's own path looking for node_modules
// (dist/backend/src -> dist/backend -> dist -> repo root -> ...), so it can never see
// backend/node_modules, which is a sibling of dist/, not an ancestor. Without this,
// `node ../dist/backend/src/server.js` fails with "Cannot find module 'dotenv'" (or any other
// dependency) even though npm install succeeded.
//
// Fix: symlink dist/node_modules -> backend/node_modules, so it sits on that ancestor chain.
// Runs as a "postbuild" script, after `tsc` produces dist/. Only affects the compiled-output
// path - nodemon/vitest/ts-node run from backend/ directly and are unaffected.
const fs = require('fs')
const path = require('path')

const backendNodeModules = path.resolve(__dirname, '..', 'node_modules')
const distNodeModules = path.resolve(__dirname, '..', '..', 'dist', 'node_modules')

if (!fs.existsSync(backendNodeModules)) {
    throw new Error(`Expected ${backendNodeModules} to exist - run npm install before building.`)
}

fs.rmSync(distNodeModules, { recursive: true, force: true })
fs.symlinkSync(backendNodeModules, distNodeModules, 'junction')
