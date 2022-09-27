import * as pulumi from "@pulumi/pulumi";
import {
  ImageRegistrySecret,
  StorageClassMeta,
} from "@proxima-one/pulumi-k8s-base";

export interface DeployedAppStack {
  kubeconfig: pulumi.Input<string>;
  appGroups: pulumi.Input<pulumi.Input<AppGroup>[]>;
  imageRegistrySecrets: pulumi.Input<pulumi.Input<ImageRegistrySecret>[]>;
  services: pulumi.Input<pulumi.Input<DeployedService>[]>;
  publicHost: pulumi.Input<string>;
  storageClasses?: pulumi.Input<pulumi.Input<StorageClassMeta>[]>;
}

export interface AppGroup {
  name: pulumi.Input<string>;
  namespace: pulumi.Input<string>;
  nodeSelectors: pulumi.Input<Record<string, string>>;
}

export interface DeployedService {
  name: pulumi.Input<string>;
  type: pulumi.Input<string>;
  params: pulumi.Input<any>;
}
