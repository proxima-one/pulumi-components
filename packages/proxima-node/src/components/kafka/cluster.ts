import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as k8sClient from "@kubernetes/client-node";
import { ResourceRequirements, NewStorageClaim } from "../types";

/**
 * Installs kafka cluster as CustomResource. Kafka operator must be installed first
 */
export class KafkaCluster extends pulumi.ComponentResource {
  /**
   * If publicHost is given - certificate will be created via cert-manager
   */
  public readonly kafka?: k8s.apiextensions.CustomResource;

  //public readonly connectionDetails?: pulumi.Output<ExternalConnectionDetails>;
  public readonly kafkaUser?: k8s.apiextensions.CustomResource;
  public readonly connectionDetails: pulumi.Output<KafkaConnectionDetails>;

  public constructor(
    name: string,
    args: KafkaClusterArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:KafkaCluster", name, args, opts);

    const resolvedArgs = pulumi.output(args);
    this.kafka = new k8s.apiextensions.CustomResource(
      name,
      {
        apiVersion: "kafka.strimzi.io/v1beta2",
        kind: "Kafka",
        metadata: {
          namespace: args.namespace,
        },
        spec: {
          kafka: {
            version: args.version ?? "2.8.0",
            replicas: args.replicas ?? 1,
            listeners: [
              {
                name: "plain",
                port: 9092,
                type: "internal",
                tls: false,
              },
              {
                name: "tls",
                port: 9093,
                type: "internal",
                tls: true,
              },
              args.kafka.listeners?.external
                ? {
                    name: "external",
                    port: 9094,
                    type: args.kafka.listeners.external.type,
                    tls: true,
                    authentication: {
                      type: "tls",
                    },
                  }
                : null,
            ].filter((x) => x),
            config: {
              "offsets.topic.replication.factor": args.replicas ?? 1,
              "transaction.state.log.replication.factor": 1,
              "transaction.state.log.min.isr": 1,
              "log.message.format.version": "2.8",
              "inter.broker.protocol.version": "2.8",
            },
            storage: {
              type: "persistent-claim",
              deleteClaim: false,
              size: resolvedArgs.kafka.storage.size,
              class: resolvedArgs.kafka.storage.class,
            },
          },
          zookeeper: {
            replicas: 1,
            storage: {
              type: "persistent-claim",
              deleteClaim: false,
              size: resolvedArgs.zookeeper.storage.size,
              class: resolvedArgs.zookeeper.storage.class,
            },
            resources: args.zookeeper.resources ?? {
              requests: {
                memory: "400Mi",
                cpu: "100m",
              },
              limits: {
                memory: "1Gi",
                cpu: "250m",
              },
            },
          },
          entityOperator: {
            // topicOperator: {
            //   resources: {
            //     requests: {
            //       memory: '250Mi',
            //       cpu: '50m',
            //     },
            //     limits: {
            //       memory: '500Mi',
            //       cpu: '100m',
            //     },
            //   },
            // },
            userOperator: {
              resources: {
                requests: {
                  memory: "250Mi",
                  cpu: "50m",
                },
                limits: {
                  memory: "500Mi",
                  cpu: "1000m",
                },
              },
            },
          },
        },
      },
      {
        parent: this,
      }
    );

    if (args.kafka.listeners?.external) {
      this.kafkaUser = new k8s.apiextensions.CustomResource(
        `${name}-ext-user`,
        {
          apiVersion: "kafka.strimzi.io/v1beta2",
          kind: "KafkaUser",
          metadata: {
            namespace: args.namespace,
            labels: {
              "strimzi.io/cluster": this.kafka.metadata.name,
            },
          },
          spec: {
            authentication: {
              type: "tls",
            },
          },
        },
        { parent: this }
      );

      // this.connectionDetails =  pulumi.all([this.kafkaUser.metadata, args.namespace.metadata, this.kafka.metadata])
      //   .apply(([user, namespace, cluster]) => this.getExternalConnectionDetails(namespace.name, cluster.name));
    }

    this.connectionDetails = pulumi
      .concat(
        this.kafka.metadata.name,
        "-kafka-brokers",
        ".",
        this.kafka.metadata.namespace,
        ".svc.cluster.local:9092"
      )
      .apply((endpoint) => {
        return {
          brokers: [endpoint],
          ssl: false,
          replicationFactor: args.replicas ?? 1,
        };
      });

    this.registerOutputs({
      connectionDetails: this.connectionDetails,
    });
  }
  //
  // private getExternalConnectionDetails(namespace: string, clusterName: string): pulumi.Output<ExternalConnectionDetails> {
  //   const provider = this.getProvider("kubernetes::") as any;
  //   const kubeConfig = provider?.kubeconfig as pulumi.Output<string>;
  //
  //   const kc = new k8sClient.KubeConfig();
  //
  //   return kubeConfig.apply(async config => {
  //     pulumi.log.info(`kube config ${config}`);
  //     kc.loadFromString(config);
  //     const k8sApi = kc.makeApiClient(k8sClient.CoreV1Api);
  //
  //     await pulumi.log.info(`Waiting for kafka cluster ${clusterName} external listener to provide connection details`);
  //
  //     const svcName = `${clusterName}-kafka-external-bootstrap`;
  //     const caCertSecretName = `${clusterName}-cluster-ca-cert`;
  //
  //     const serviceIpAddress = await waitUntilSucceed(`k8s::${svcName}`, async () => {
  //       const svc = await k8sApi.readNamespacedService(svcName, namespace);
  //       if (!svc.body.status
  //         || !svc.body.status.loadBalancer
  //         || !svc.body.status.loadBalancer.ingress
  //         || svc.body.status.loadBalancer.ingress.length == 0)
  //         throw new Error(`Service ${svcName} not ready`);
  //
  //       return svc.body.status.loadBalancer.ingress[0].ip;
  //     });
  //     const caCertSecretData = await waitUntilSucceed(`k8s::${caCertSecretName}`, async () => {
  //       const ca = await k8sApi.readNamespacedSecret(caCertSecretName, namespace);
  //       if (!ca.body.data)
  //         throw new Error(`Secret ${caCertSecretName} not ready`);
  //
  //       return ca.body.data;
  //     });
  //
  //     return {
  //       host: `${serviceIpAddress}:9094`,
  //       tls: {
  //         ca: caCertSecretData["ca.p12"],
  //         key: "",
  //         cert: "",
  //       }
  //     };
  //   });
  // }
}

async function waitUntilSucceed<T>(
  resource: string,
  func: () => Promise<T>,
  timeout?: number,
  interval: number = 500
): Promise<T> {
  const startTimestamp = Date.now();
  while (true) {
    try {
      return await func();
    } catch (error: any) {
      await sleep(interval);

      if (!timeout) continue;

      if (Date.now() > startTimestamp + timeout)
        throw new Error(
          `Error waiting for ${resource}: timeout of ${timeout}ms exceeded`
        );
    }
  }
}

async function sleep(timeout: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), timeout);
  });
}

export interface KafkaClusterArgs {
  namespace: pulumi.Input<string>;
  /**
   * Brokers count. Default 1
   */
  replicas?: number;
  version?: string;
  kafka: {
    storage: pulumi.Input<NewStorageClaim>;
    resources?: ResourceRequirements;
    listeners?: {
      external?: {
        type: "loadbalancer";
      };
    };
  };
  zookeeper: {
    storage: pulumi.Input<NewStorageClaim>;
    resources?: ResourceRequirements;
  };
}

export interface KafkaConnectionDetails {
  brokers: string[];
  ssl: boolean;
  replicationFactor: number;
}
