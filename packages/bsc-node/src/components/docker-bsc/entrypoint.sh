#!/bin/sh

set -e

echo "Proxima: Bsc entrypoint..."
# ensure initial setup

initializedFile=$DATA_DIR/.initialized

genesisOverrideFile=/proxima/genesis.json

if [ ! -f "$initializedFile" ]; then
  echo "Initializing BSC..."

  geth --datadir "$DATA_DIR" init "$genesisOverrideFile"

  touch "$initializedFile"
  echo "Initialized BSC"
fi

# start bsc
geth "$@"
