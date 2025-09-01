#!/bin/bash
# Fix all test file imports to add .js extensions

for file in $(find src -name "*.test.ts"); do
  # Fix relative imports to add .js extension
  sed -i.bak -E "s/from '(\\.\\.[^']+)'/from '\\1.js'/g" "$file"
  sed -i.bak -E "s/from '(\\.[^']+)'/from '\\1.js'/g" "$file"
  # Remove duplicate .js.js
  sed -i.bak -E "s/\\.js\\.js/.js/g" "$file"
  # Remove backup files
  rm "${file}.bak"
done

echo "Fixed imports in test files"
