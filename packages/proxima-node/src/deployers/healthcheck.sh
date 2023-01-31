currentMs=$(date +%s%3N)
lastTouchS=$(stat --format='%.3Y' "/var/proxima/$APP_ID/last_event")

delay=$(echo - | awk -v lastTouchS="$lastTouchS" -v currentMs="$currentMs" '{print currentMs-lastTouchS*1000}')

if  [ $delay -gt $HEARTBEAT_LIMIT_MS ] ; then
  echo "delay is greater than ${HEARTBEAT_LIMIT_MS}."
  exit 1
fi

exit 0
