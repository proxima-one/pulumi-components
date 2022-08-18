import * as pulumi from "@pulumi/pulumi";

export * from "./indexerDeployment";
export * from "./indexerMongo";
export * from "./ingress";
export * from "./shard";

export function StackNameToEnvName(
  s: pulumi.Input<string>
): pulumi.Input<string> {
  return pulumi.output(s).apply((str) => {
    switch (str) {
      case "amur":
        return "prod";
      case "amur-dev":
        return "dev";
      case "amur-qa":
        return "qa";
      default:
        return "undefined";
    }
  });
}
