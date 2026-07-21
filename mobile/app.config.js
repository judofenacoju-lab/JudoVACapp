const base = require('./app.json').expo

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  ...base,
  android: {
    ...base.android,
    usesCleartextTraffic: true
  },
  plugins: [
    ...(base.plugins || []),
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true
        }
      }
    ]
  ]
}
