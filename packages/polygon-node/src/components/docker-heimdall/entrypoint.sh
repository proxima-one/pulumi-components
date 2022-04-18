#!/bin/sh

set -e

echo "Proxima: Heimdall entrypoint..."
# ensure initial setup

initializedFile=$DATA_DIR/.initialized

configOverrideFile=$DATA_DIR/proxima/config.toml
configFile=$DATA_DIR/config/config.toml

heimdallConfigOverrideFile=$DATA_DIR/proxima/heimdall-config.toml
heimdallConfigFile=$DATA_DIR/config/heimdall-config.toml

genesisOverrideFile=$DATA_DIR/proxima/genesis.json
genesisFile=$DATA_DIR/config/genesis.json

if [ ! -f "$initializedFile" ]; then
  echo "Initializing Heimdall..."

  heimdalld init --home "$DATA_DIR"

  if [ -f "$genesisOverrideFile" ]; then
    echo "Overriding $genesisFile"
    cp -p "$genesisOverrideFile" "$genesisFile"
  fi

  touch "$initializedFile"
  echo "Initialized Heimdall"
fi

if [ -f "$heimdallConfigOverrideFile" ]; then
  echo "Overriding $heimdallConfigFile"
  cp -p "$heimdallConfigOverrideFile" "$heimdallConfigFile"
fi

if [ -f "$configOverrideFile" ]; then
  echo "Overriding $configFile"
  cp -p "$configOverrideFile" "$configFile"
fi

# start bor
heimdalld "$@"
