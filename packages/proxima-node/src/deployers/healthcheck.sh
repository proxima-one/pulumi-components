currentSeconds=$(date +%s)
lastTouchSeconds=$(date -r "/var/proxima/$APP_ID/last_event" +%s)

delay=$(expr $currentSeconds - $lastTouchSeconds)
if  [ $delay -gt $HEARTBEAT_LIMIT_SECONDS ] ; then
  echo "delay is greater than ${HEARTBEAT_LIMIT_SECONDS}."
  exit 1
fi

exit 0
