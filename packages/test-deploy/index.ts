//require("./tsfix");
//import * as proxima from "@proxima-one/pulumi-service-apps";
import {
  AppDeployerBase,
  IndexingServiceDeployer,
} from "@proxima-one/pulumi-service-apps";
import * as k8sServices from "@proxima-one/pulumi-proxima-node";

/*
const streamingAppDeployer = new proxima.StreamingAppDeployer({
  targetStack: "buh",
  targetDb: { type: "import-kafka", name: "core-us" },
  tuningArgs: {
    batch: 500,
    readBuffer: 10000,
  },
});
const app = new proxima.StreamingApp({
  name: "eth-connector-test",
  args: {
    network: "eth-goerli",
    blockTimeout: 90000,
    maxReorgDepth: 200,
    genesisTimestampMs: 1438269973000,
  },
  input: null,
  output: {
    default: "proxima-test.eth-goerli.blocks",
    blockSync: "proxima-test.eth-goerli.connect",
  },
  executable: {
    image: "quay.io/proxima.one/streaming-app:eth-0.11.3",
    app: "eth-connector",
  },
  version: proxima.SemVer.parse("1.0.0"),
  requirements: {
    network: "eth-goerli",
  },
});
const app2 = new proxima.StreamingApp({
  name: "eth-connector-test",
  args: {
    network: "eth-goerli",
    blockTimeout: 90000,
    maxReorgDepth: 200,
    genesisTimestampMs: 1438269973000,
  },
  input: `${app.output.default}?height=1000`,
  output: {
    default: "proxima-test.eth-goerli.blocks",
    blockSync: "proxima-test.eth-goerli.connect",
  },
  executable: {
    image: "quay.io/proxima.one/streaming-app:eth-0.11.3",
    app: "eth-connector",
  },
  version: proxima.SemVer.parse("1.0.0"),
  requirements: {
    network: "eth-goerli",
  },
});
streamingAppDeployer.deploy(app);
streamingAppDeployer.deploy(app2);
 */

//export const streamDbs = [streamingAppDeployer.targetDb];

//
// class TestDeployer extends AppDeployerBase {
//   public deploy() {
//     const network = "eth-main";
//     new k8sServices.EvmIndexerDeployer(this.getDeployParams("indexing")).deploy(
//       {
//         name: network,
//         env: "prod",
//         connection: {
//           http: network,
//           wss: network,
//         },
//         resources: "100m/2000m,300Mi/2Gi",
//         db: {
//           type: "provision",
//           params: {
//             resource: "100m/400m,100Mi/2Gi",
//             storage: {size: "100Gi", class: {type: "ssd", fstype: "xfs"}},
//           },
//         },
//       }
//     );
//   }
// }
//
// new TestDeployer({targetStack: "buh", project: "dev-test"}).deploy();

const indexDeployer = new IndexingServiceDeployer({
  targetStack: "buh",
  project: "dev-test",
});

import * as k8s from "@pulumi/kubernetes";

indexDeployer.deploy({
  apiKind: "indexing-service/v3",

  imageName: "quay.io/proxima.one/services:index-ft-balances-v1.0.12",
  indexName: "ft-balances-test",
  shardName: "0",
  type: "single-pod",
  streams: {
    Transfers: [
      {
        id: "proxima.erc20.polygon-mumbai.events.1_0",
        metadata: {
          networks: ["polygon-mumbai"],
        },
      },
    ],
  },
  resources: {
    consumer: "100m/2000m,100Mi/2Gi",
  },
  mode: "fast-sync",
  db: {
    type: "pvc",
    storage: {
      class: "premium-rwo",
      size: "10Gi",
    },
  },
});
