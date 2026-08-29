#!/usr/bin/env bash
# Resets mock_data/ to the clean baseline in mock_data.seed/.
#
# Run this on first checkout (mock_data/ is gitignored since it's a runtime
# datastore the backend writes to), or any time you want a fresh slate after
# testing has left permits/spaces in a dirty state.

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p mock_data
cp mock_data.seed/*.csv mock_data/

echo "mock_data/ reset from mock_data.seed/"
