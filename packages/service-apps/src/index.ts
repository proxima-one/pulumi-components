import * as pulumi from "@pulumi/pulumi";

//export * from "./deployments"
//export * from "./shard";

// export function StackNameToEnvName(
//   s: pulumi.Input<string>
// ): pulumi.Input<string> {
//   return pulumi.output(s).apply((str) => {
//     switch (str) {
//       case "amur":
//         return "prod";
//       case "amur-dev":
//         return "dev";
//       case "amur-qa":
//         return "qa";
//       default:
//         return "undefined";
//     }
//   });
// }

export * from "./deployer";
