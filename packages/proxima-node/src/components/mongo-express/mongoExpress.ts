import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";
import * as random from "@pulumi/random";

import { Password, ResourceRequirements } from "../types";

export interface MongoExpressArgs {
  namespace: pulumi.Input<string>;
  resources?: ResourceRequirements;
  nodeSelector?: pulumi.Input<Record<string, string>>;

  mongodbServer: pulumi.Input<string>;
  mongoAdminAuth: MongoExpressDbAuth;
  auth?: MongoExpressAuth;
  publicHost?: pulumi.Input<string>;
}

export interface MongoExpressDbAuth {
  username: string;
  password: pulumi.Input<string>;
}

export interface MongoExpressAuth {
  username: string;
  password: Password;
}

export class MongoExpress extends pulumi.ComponentResource {
  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly username: string;
  public readonly password: pulumi.Output<string>;
  public readonly ingress?: k8s.networking.v1.Ingress;

  public constructor(
    name: string,
    args: MongoExpressArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MongoExpress", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);
    const auth: MongoExpressAuth = args.auth ?? {
      username: "mongo-express",
      password: {
        type: "random",
        name: `${name}-secret`,
      },
    };
    const siteCookieSecret: Password = {
      type: "random",
      length: 32,
      name: `${name}-site-cookie-secret`,
    };
    const siteSessionSecret: Password = {
      type: "random",
      length: 32,
      name: `${name}-site-session-secret`,
    };

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: "https://cowboysysop.github.io/charts/",
        },
        chart: "mongo-express",
        version: "2.7.1",
        namespace: args.namespace,
        values: {
          nodeSelector: args.nodeSelector,
          mongodbServer: args.mongodbServer,
          mongodbEnableAdmin: true,
          mongodbAdminUsername: args.mongoAdminAuth.username,
          mongodbAdminPassword: args.mongoAdminAuth.password,
          basicAuthUsername: auth.username,
          basicAuthPassword: passwords.resolve(auth.password),
          siteCookieSecret: passwords.resolve(siteCookieSecret),
          siteSessionSecret: passwords.resolve(siteSessionSecret),
          livenessProbe: {
            timeoutSeconds: 10,
            failureThreshold: 10,
            periodSeconds: 60,
          },
          readinessProbe: {
            timeoutSeconds: 10,
            failureThreshold: 10,
            periodSeconds: 60,
          },
        },
      },
      { parent: this }
    );

    const svcName = `${name}`;

    if (args.publicHost) {
      this.ingress = new k8s.networking.v1.Ingress(
        `${name}`,
        {
          metadata: {
            namespace: args.namespace,
            annotations: helpers.ingressAnnotations({
              certIssuer: "letsencrypt",
              sslRedirect: true,
              bodySize: "300m",
            }),
          },
          spec: helpers.ingressSpec({
            host: args.publicHost,
            path: "/",
            backend: {
              service: {
                name: svcName,
                port: 8081,
              },
            },
            tls: {
              secretName: `${svcName}-tls`,
            },
          }),
        },
        { parent: this }
      );
    }

    this.resolvedPasswords = passwords.getResolvedPasswords();
    this.username = auth.username;
    this.password = passwords.resolve(auth.password);

    this.registerOutputs({
      username: this.username,
      password: this.password,
    });
  }
}
