#!/bin/bash
cd /home/kavia/workspace/code-generation/roadrescue-quickassist-interface-42167/roadrescue_quickassist_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

