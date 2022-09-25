import * as pulumi from "@pulumi/pulumi";

/*
  Easy describe compute resources. Samples:
  - 100m/1000m,100Mi/2Gi
  - { cpu: "100m/1000m", memory: "100Mi/2Gi"}
 */
export type ComputeResources =
  | {
      cpu: string;
      memory: string;
    }
  | string;

export interface StorageClassMeta {
  name: string;
  labels: Record<string, string>;
}

/*
  Describe PVC to use: existing or create new
 */
export type Storage =
  | string
  | {
      size: string;
      class: StorageClassRequest;
    };

/*
  Kubernetes size format like 100Gi
 */
export type StorageSize = string;

/*
  Reference class by name or by labels: { "fstype": "xfs", "type": "ssd" }
 */
export type StorageClassRequest = string | Record<string, string>;
