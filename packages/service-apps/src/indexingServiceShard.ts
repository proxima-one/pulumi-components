// import * as pulumi from "@pulumi/pulumi";
// import * as k8s from "@pulumi/kubernetes";
// import * as ingress from "./ingress";
// import { ResourceRequirements, ParseResourceRequirements } from "./shard";
// import { resourceToDefinition, ShardResource } from "./shardDefinition";
//
// export interface IndexingServiceShardArgs {
//   namespace: pulumi.Input<string>;
//   shardName: pulumi.Input<string>;
//   indexName: pulumi.Input<string>;
//   shard: pulumi.Input<ShardResource>;
//   deployment: pulumi.Input<DeploymentArgs>;
// }
//
// export interface IndexingServiceShardOutput {
//   backgroundWorkers: k8s.apps.v1.Deployment[];
//   service: k8s.core.v1.Service;
// }
//
// export interface DeploymentArgs {
//   env: pulumi.Input<string>;
//   imagePullSecret?: pulumi.Input<string>;
//   nodeSelector?: pulumi.Input<Record<string, string>>;
//   publicHost?: pulumi.Input<string | string[]>;
//   onlyService?: boolean;
// }
//
// export class IndexingServiceShard extends pulumi.ComponentResource implements IndexingServiceShardOutput {
//   public readonly backgroundWorkers: k8s.apps.v1.Deployment[] = [];
//   public readonly service: k8s.core.v1.Service;
//
//   public constructor(
//     name: string,
//     args: IndexingServiceShardArgs,
//     opts: pulumi.ComponentResourceOptions
//   ) {
//     super("proxima-k8s:IndexingServiceShard", name, args, opts);
//
//     const shardDef = pulumi.output(args.shard).apply(resourceToDefinition);
//
//     const labels: Record<string, pulumi.Input<string>> = {
//       app: name,
//       monitoring: "true",
//       env: pulumi.output(args.deployment).env,
//       index: args.indexName,
//       shard: args.shardName,
//     };
//
//     this.deployment = new k8s.apps.v1.Deployment(
//       name,
//       {
//         metadata: {
//           namespace: args.namespace,
//         },
//         spec: {
//           replicas: args.replicas ? args.replicas : 1,
//           selector: {
//             matchLabels: labels,
//           },
//           template: {
//             metadata: {
//               labels: labels,
//             },
//             spec: {
//               restartPolicy: "Always",
//               nodeSelector: args.nodeSelector,
//               imagePullSecrets: [
//                 {
//                   name: args.imagePullSecret,
//                 },
//               ],
//               containers: [
//                 {
//                   image: args.image,
//                   name: name,
//                   args: args.containerArgs,
//                   env: args.env
//                     ? Object.entries(args.env).map(
//                       ([key, value]: [string, pulumi.Input<string>]) => ({
//                         name: key,
//                         value: value,
//                       })
//                     )
//                     : [],
//                   ports: args.containerPorts
//                     ? args.containerPorts.map((port: Port) => ({
//                       name: port.name,
//                       containerPort: port.port,
//                     }))
//                     : [],
//                   resources: ParseResourceRequirements(args.resources),
//                 },
//               ],
//             },
//           },
//         },
//       },
//       { parent: this }
//     );
//
//     if (args.endpoints) {
//       this.service = new k8s.core.v1.Service(
//         `${name}`,
//         {
//           metadata: {
//             namespace: args.namespace,
//           },
//           spec: {
//             selector: labels,
//             ports: args.endpoints.map((endpoint) => ({
//               name: endpoint.name,
//               protocol: "TCP",
//               port: endpoint.servicePort,
//               targetPort: endpoint.servicePort,
//             })),
//           },
//         },
//         { dependsOn: this.deployment, parent: this }
//       );
//
//       for (const endpoint of args.endpoints) {
//         new k8s.networking.v1.Ingress(
//           `${name}-${endpoint.name}`,
//           {
//             metadata: {
//               namespace: args.namespace,
//               annotations: ingress.ingressAnnotations({
//                 certIssuer: endpoint.type == "grpc" ? "letsencrypt" : undefined,
//                 sslRedirect: endpoint.type == "grpc",
//                 hsts: endpoint.type == "grpc",
//                 backendGrpc: endpoint.type == "grpc",
//                 bodySize: "300m",
//               }),
//             },
//             spec: ingress.ingressSpec({
//               host: endpoint.endpoint,
//               path: "/",
//               backend: {
//                 service: {
//                   name: this.service.id.apply((s) => s.split("/")[1]), // This is needed as Pulumi sets physical name in k8s as resource_name+random_hash
//                   port: endpoint.servicePort,
//                 },
//               },
//               tls:
//                 endpoint.type == "grpc"
//                   ? {
//                     secretName: pulumi
//                       .all([endpoint.endpoint, endpoint.name])
//                       .apply(([endpoint, name]: [string, string]) =>
//                         Math.abs(
//                           GetStringHash(`${endpoint}-${name}-tls`)
//                         ).toString()
//                       ),
//                   }
//                   : undefined,
//             }),
//           },
//           { dependsOn: this.service, parent: this }
//         );
//       }
//     }
//   }
// }
