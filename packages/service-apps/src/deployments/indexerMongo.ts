// import * as pulumi from "@pulumi/pulumi";
// import * as proxima from "@proxima-one/pulumi-proxima-node";
// import { ParseResourceRequirements, ResourceRequirements } from "./shard";
//
// export interface IndexerMongoArgs {
//   nodeSelector: pulumi.Output<Record<string, string>>;
//   resources: ResourceRequirements;
//   publicHost: pulumi.Input<string>;
//   namespace: pulumi.Input<string>;
//   size: string;
// }
//
// export class IndexerMongo extends proxima.MongoDB {
//   public constructor(
//     name: string,
//     args: IndexerMongoArgs,
//     opts: pulumi.ComponentResourceOptions
//   ) {
//     super(
//       name,
//       {
//         nodeSelector: args.nodeSelector,
//         resources: ParseResourceRequirements(args.resources),
//         namespace: args.namespace,
//         auth: {
//           user: "proxima",
//           password: { type: "random", name: `${name}-mongo-db` },
//           database: "proxima",
//         },
//         storage: {
//           type: "new",
//           class: "premium-rwo-xfs",
//           size: args.size,
//         },
//         mongoExpress: {
//           endpoint: pulumi
//             .output(args.publicHost)
//             .apply((host) => `${name}-mongo-express.${host}`),
//         },
//       },
//       opts
//     );
//   }
// }
