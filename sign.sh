# /usr/bin/env bash
# web-ext.js sign
# 
# Submit the extension to Mozilla Add-ons (AMO) for signing so it can be installed in Firefox
# 
# Options:
#       --version             Show version number  [boolean]
#   -s, --source-dir          Web extension source directory.  [string] [required] [default: "/home/brian/projects/ff-yt-subs"]
#   -a, --artifacts-dir       Directory where artifacts will be saved.  [string] [required] [default: "/home/brian/projects/ff-yt-subs/web-ext-artifacts"]
#   -v, --verbose             Show verbose output  [boolean]
#   -i, --ignore-files        A list of glob patterns to define which files should be ignored. (Example: --ignore-files=path/to/first.js path/to/second.js "**/*.log")  [array]
#       --no-input            Disable all features that require standard input  [boolean]
#   -c, --config              Path to a CommonJS config file to set option defaults  [string]
#       --config-discovery    Discover config files in home directory and working directory. Disable with --no-config-discovery.  [boolean] [default: true]
#       --amo-base-url        Submission API URL prefix  [string] [required] [default: "https://addons.mozilla.org/api/v5/"]
#       --api-key             API key (JWT issuer) from addons.mozilla.org  [string] [required]
#       --api-secret          API secret (JWT secret) from addons.mozilla.org  [string] [required]
#       --api-proxy           Use a proxy to access the signing API. Example: https://yourproxy:6000  [string]
#       --timeout             Number of milliseconds to wait before giving up  [number]
#       --approval-timeout    Number of milliseconds to wait for approval before giving up. Set to 0 to disable waiting for approval. Fallback to `timeout` if not set.  [number]
#       --channel             The channel for which to sign the addon. Either 'listed' or 'unlisted'.  [string] [required]
#       --amo-metadata        Path to a JSON file containing an object with metadata to be passed to the API. See https://addons-server.readthedocs.io/en/latest/topics/api/addons.html for details.  [string]
#       --upload-source-code  Path to an archive file containing human readable source code of this submission, if the code in --source-dir has been processed to make it unreadable. See https://extensionworkshop.com/documentation/publish/source-code-submission/ for details.  [string]
#   -h, --help                Show help  [boolean]

web-ext sign -s $(pwd)/src --api-key "user:20243611:422" --api-secret $(sops -d secrets/ff_api_keys.json | jq -r .secret) --channel=unlisted
