#!/bin/bash
set -e
# psql with --username only would default to a DB named after the user; that
# DB does not exist in our setup (POSTGRES_DB=postgres), so we must specify
# the connection target explicitly.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE abadge_test;
  GRANT ALL PRIVILEGES ON DATABASE abadge_test TO $POSTGRES_USER;
EOSQL
