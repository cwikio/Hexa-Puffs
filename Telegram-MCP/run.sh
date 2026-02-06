#!/bin/bash
set -a
source /Users/tomasz/Coding/MCPs/Telegram/.env
set +a
exec node /Users/tomasz/Coding/MCPs/Telegram/dist/src/index.js
