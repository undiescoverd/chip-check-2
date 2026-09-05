// `server-only` throws when resolved outside the react-server condition, which is exactly
// what it is for — but it makes `lib/server/*` unimportable from Vitest. The vitest
// configs alias the package to this empty module so server code can be unit-tested.
export {};
