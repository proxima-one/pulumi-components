#!/bin/sh

set -e

lastEventFile="/var/proxima/$APP_ID/last_event"

re='^[0-9]+$'
if ! [[ $HEARTBEAT_LIMIT_SECONDS =~ $re ]] ; then
   echo "HEARTBEAT_LIMIT_SECONDS not set or not a number"
   exit 0
fi

if [ ! -e $lastEventFile ] ;
then
    echo "last event file doesn't exist"
    exit 1
fi

currentSeconds=$(date +%s)
lastTouchSeconds=$(date -r "$lastEventFile" +%s)

delay=$(($currentSeconds - $lastTouchSeconds))
if  [ $delay -gt $HEARTBEAT_LIMIT_SECONDS ] ; then
  echo "Delay is greater than ${HEARTBEAT_LIMIT_SECONDS}.\n CurrentSeconds: ${currentSeconds}\n LastTouchSeconds: ${lastTouchSeconds}"
  exit 1
fi

exit 0
