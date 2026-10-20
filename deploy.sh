#!/bin/sh
# 빌드 결과(dist)를 gh-pages 브랜치로 올려 GitHub Pages에 배포한다.
set -e
npm run build
cd dist
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" commit -q -m "deploy"
git push -f "$(git -C .. remote get-url origin)" gh-pages
