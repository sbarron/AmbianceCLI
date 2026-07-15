class Database {
  exec(_sql, callback) {
    callback?.(null);
    return this;
  }

  prepare() {
    return {
      run: (_params, callback) => callback?.(null),
      all: (_params, callback) => callback?.(null, []),
      get: (_params, callback) => callback?.(null, null),
      finalize: callback => callback?.(null),
    };
  }

  close(callback) {
    callback?.(null);
  }
}

module.exports = { Database };
