FROM apextoaster/node:10.1

# copy native modules
COPY node_modules/ /app/node_modules/

# copy build output
COPY out/ /app/out/

WORKDIR /app

ENTRYPOINT [ "/usr/bin/node", "/app/out/main-bundle.js" ]
