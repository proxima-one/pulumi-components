import * as pulumi from "@pulumi/pulumi";
import * as proxima from "@proxima-one/pulumi-service-apps";
import { IndexingServiceDeployer } from "@proxima-one/pulumi-service-apps";

const indexDeployer = new IndexingServiceDeployer({
  targetStack: "buh",
  project: "dev-test",
});

const shard0 = indexDeployer.deploy({
  apiKind: "indexing-service/v1",

  imageName: "quay.io/proxima.one/services:fungible-token-apis-0.0.29-29769d6",
  name: "ft-test-0",
  network: "eth-goerli",
  stream:
    "v1.eth-goerli.fungible-token.streams.proxima.one;" +
    "v1.new-tokens.eth-goerli.fungible-token.streams.proxima.one",
  db: {
    endpoint: {
      type: "provision",
      resources: "50m/500m,100Mi/600Mi",
      storage: {
        type: "new",
        size: "100Gi",
        class: "premium-rwo-xfs",
      },
    },
  },
  resources: {
    consumer: "50m/1000m,100Mi/400Mi",
    server: "50m/500m,100Mi/300Mi",
  },
});

const cloudShard = indexDeployer.deploy({
  apiKind: "indexing-service/v1",
  name: "ft-test-1",

  imageName: "quay.io/proxima.one/services:fungible-token-apis-0.0.29-29769d6",
  network: "eth-goerli",
  stream:
    "v1.eth-goerli.fungible-token.streams.proxima.one;" +
    "v1.new-tokens.eth-goerli.fungible-token.streams.proxima.one",
  db: {
    endpoint: { type: "import", name: "indexingservices-01" },
    name: "dev-test-db-delete-me",
  },
});
