#!/bin/sh

set -e

echo "Proxima: Bor entrypoint..."
# ensure initial setup
#
#dataDir=$BOR_DATADIR
#initializedFile=$dataDir/.initialized
#genesisFile=/config/genesis.json
#
#if [ ! -f "$initializedFile" ]; then
#  if [ -f "$genesisFile" ]; then
#    bor --datadir $dataDir init $genesisFile
#  else
#      echo "Skipping init"
#  fi
#  touch $initializedFile
#fi

# start bor
bor "$@"
