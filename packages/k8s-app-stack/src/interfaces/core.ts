import * as pulumi from "@pulumi/pulumi";
import { ImageRegistrySecret } from "@proxima-one/pulumi-k8s-base";

export interface DeployedAppStack {
  appGroups: AppGroup[];
  imageRegistrySecrets: ImageRegistrySecret[];
  services: DeployedService[];
}

export interface AppGroup {
  name: string;
  namespace: string;
  nodeSelectors: Record<string, string>;
}

export interface DeployedService {
  name: string;
  type: string;
  params: pulumi.Input<any>;
}
