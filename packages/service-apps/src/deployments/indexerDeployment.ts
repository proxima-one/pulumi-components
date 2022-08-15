// import * as pulumi from "@pulumi/pulumi";
// import * as k8s from "@pulumi/kubernetes";
// import * as ingress from "./ingress";
// import { ResourceRequirements, ParseResourceRequirements } from "./shard";
//
// function GetStringHash(s: string): number {
//   let hash = 0,
//     i,
//     chr;
//   if (s.length === 0) return hash;
//   for (i = 0; i < s.length; i++) {
//     chr = s.charCodeAt(i);
//     hash = (hash << 5) - hash + chr;
//     hash |= 0; // Convert to 32bit integer
//   }
//   return hash;
// }
//
// export interface Port {
//   name: string;
//   port: number;
// }
//
// export interface IndexerDeploymentArgs {
//   image: pulumi.Input<string>;
//   nodeSelector: pulumi.Output<Record<string, string>>;
//   containerArgs?: pulumi.Input<string>[];
//   replicas?: pulumi.Input<number>;
//   env?: Record<string, pulumi.Input<string>>;
//   imagePullSecret: pulumi.Input<string>;
//   resources: ResourceRequirements;
//   containerPorts?: Port[];
//   namespace: pulumi.Input<string>;
//   proximaEnv: pulumi.Input<string>;
//   shardId: pulumi.Input<string>;
//   indexerName: pulumi.Input<string>;
//   endpoints?: IndexerEndpoint[];
// }
//
// export interface IndexerEndpoint {
//   name: pulumi.Input<string>;
//   endpoint: pulumi.Input<string>;
//   servicePort: number;
//   type: "http" | "grpc";
// }
//
// export class IndexerDeployment extends pulumi.ComponentResource {
//   public readonly deployment: k8s.apps.v1.Deployment;
//
//   public readonly service: k8s.core.v1.Service | undefined;
//
//   public constructor(
//     name: string,
//     args: IndexerDeploymentArgs,
//     opts: pulumi.ComponentResourceOptions
//   ) {
//     super("proxima-k8s:IndexerDeployment", name, args, opts);
//
//     const labels: Record<string, pulumi.Input<string>> = {
//       app: name,
//       monitoring: "true",
//       env: args.proximaEnv,
//       index: args.indexerName,
//       shard: args.shardId,
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
//                         ([key, value]: [string, pulumi.Input<string>]) => ({
//                           name: key,
//                           value: value,
//                         })
//                       )
//                     : [],
//                   ports: args.containerPorts
//                     ? args.containerPorts.map((port: Port) => ({
//                         name: port.name,
//                         containerPort: port.port,
//                       }))
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
//                       secretName: pulumi
//                         .all([endpoint.endpoint, endpoint.name])
//                         .apply(([endpoint, name]: [string, string]) =>
//                           Math.abs(
//                             GetStringHash(`${endpoint}-${name}-tls`)
//                           ).toString()
//                         ),
//                     }
//                   : undefined,
//             }),
//           },
//           { dependsOn: this.service, parent: this }
//         );
//       }
//     }
//   }
// }
