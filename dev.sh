#!/bin/bash
yarn --silent ts-node --project=tsconfig.dev.json index.tsx "$@"
