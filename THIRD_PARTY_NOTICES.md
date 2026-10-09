# 第三方与参考项目

## Mozilla Readability 0.5.0
- Source: https://github.com/mozilla/readability/tree/0.5.0
- File: vendor/Readability.js
- License: Apache-2.0, see vendor/Readability-LICENSE.txt and source header.
- Vendored SHA-256: 61521a78d29e60def9623a14ebcc5a54aff88c61fd11326d7c016478a4f23047
- The source matches the official 0.5.0 file byte for byte. The extraction wrapper uses a text serializer and never displays extracted HTML.

## Grounds
- Reference: https://github.com/cadeos/jev-grounds
- Inspected commit: d6245f3166b37f52d14c1718032846c8d98f69b2
- License: MIT; original notice retained in vendor/grounds-LICENSE.txt.
- Used as an architectural reference for extraction, background API calls and argumentation ratings. Grounds is not affiliated with this plugin.

## TypeSafe/Jev
- External service: https://api.typesafe.ai
- Documentation: https://docs.typesafe.ai/api
- Requires the user's own API key. This project is not affiliated with TypeSafe and does not bundle a key.
