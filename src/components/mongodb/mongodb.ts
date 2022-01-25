import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as helpers from '../../helpers';

import { PersistenceConfiguration, ValuesSchema } from './values';
import {
  ExistingStorageClaim,
  NewStorageClaim,
  Password,
  Resources,
} from '../types';

/**
 * Installs strimzi-kafka-operator helm chart
 */
export class MongoDB extends pulumi.ComponentResource {
  /**
   * Helm chart was used to create MongoDB instance
   */
  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;

  public constructor(
    name: string,
    args: MongoDBArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:MongoDB', name, args, opts);

    const passwords = new helpers.PasswordResolver(this);

    const values = () => {
      const persistence: PersistenceConfiguration = { enabled: true };
      if (args.storage.type == 'new') {
        persistence.size = args.storage.size;
        persistence.storageClass = args.storage.class;
      } else {
        persistence.existingClaim = args.storage.name;
      }

      const auth = args.auth
        ? pulumi
            .all(args.auth.passwords.map((p) => passwords.resolve(p)))
            .apply((passwords) => {
              return {
                enabled: true,
                usernames: args.auth!.users,
                databases: args.auth!.databases,
                passwords: passwords,
              };
            })
        : pulumi.Output.create({ enabled: false });

      return auth.apply((x) => {
        return {
          auth: x,
          persistence: persistence,
          replicaCount: 1,
          resources: args.resources ?? {
            requests: {
              cpu: '100m',
              memory: '200Mi',
            },
            limits: {
              cpu: '1000m',
              memory: '1Gi',
            },
          },
        };
      });
    };

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: 'https://charts.bitnami.com/bitnami',
        },
        chart: 'mongodb',
        version: '10.31.1',
        namespace: args.namespace.metadata.name,
        values: values(),
      },
      { parent: this }
    );

    this.resolvedPasswords = passwords.getResolvedPasswords();

    this.registerOutputs({
      resolvedPasswords: this.resolvedPasswords,
    });
  }
}

export interface MongoDBArgs {
  namespace: k8s.core.v1.Namespace;
  resources?: Resources;

  auth?: MongoDBAuth;
  storage: Storage;
}

export interface MongoDBAuth {
  users: string[];
  databases: string[];
  passwords: Password[];
}

export type Storage =
  | (NewStorageClaim & { type: 'new' })
  | (ExistingStorageClaim & { type: 'existing' });
