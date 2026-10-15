{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs { inherit system; };
    in {
      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          age
          sops 
          openssl
          ssh-to-age
          web-ext
          yq
        ];
        SOPS_AGE_KEY_CMD = ''bash -c "base64 -d ./age_keys.txt.enc | openssl enc -d -aes-256-cbc -pbkdf2"'';
      };
    });
}
