import * as pulumi from "@pulumi/pulumi";
import * as proxima from "@proxima-one/pulumi-proxima-node";
import {
  KubernetesServiceDeployer,
  StorageClassRequest,
  StorageSize,
} from "@proxima-one/pulumi-k8s-base";

export class KafkaDeployer extends KubernetesServiceDeployer {
  public deploy(args: KafkaArgs): DeployedKafka {
    const kafka = new proxima.KafkaCluster(
      args.name,
      {
        replicas: args.replicas,
        version: "3.2.1",
        kafka: {
          storage: this.storageClass(args.storage.class, {
            failIfNoMatch: true,
          })!.apply((storageClass) => ({
            class: storageClass,
            size: args.storage.size,
          })),
        },
        zookeeper: {
          storage: this.storageClass(args.zookeeperStorage.class, {
            failIfNoMatch: true,
          })!.apply((storageClass) => ({
            class: storageClass,
            size: args.zookeeperStorage.size,
          })),
        },
        namespace: this.namespace,
      },
      this.options()
    );

    return {
      name: args.name,
      type: "kafka",
      params: kafka.connectionDetails.apply((x) => ({
        connectionDetails: x,
      })),
    };
  }
}

export interface KafkaArgs {
  name: string;
  replicas?: number;
  // todo: implement a way to access kafka from outside
  //loadBalancers?: KafkaListenerType[];
  storage: {
    size: StorageSize;
    class: StorageClassRequest;
  };
  zookeeperStorage: {
    size: StorageSize;
    class: StorageClassRequest;
  };
}

//export type KafkaListenerType = "external" | "internal";

export interface DeployedKafka {
  name: string;
  type: "kafka";
  params: pulumi.Output<{
    connectionDetails: proxima.KafkaConnectionDetails;
  }>;
}
