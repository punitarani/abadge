#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE abadge_test;
  GRANT ALL PRIVILEGES ON DATABASE abadge_test TO $POSTGRES_USER;
EOSQL
