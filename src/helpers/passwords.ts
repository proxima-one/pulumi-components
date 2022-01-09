import { Password } from '../components/types';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';

export class PasswordResolver {
  private readonly pendingPasswords: [string, pulumi.Output<string>][] = [];

  public constructor(private readonly baseResource: pulumi.Resource) {}

  public resolve(password: Password): pulumi.Output<string> {
    switch (password.type) {
      case 'random':
        const pass = new random.RandomPassword(
          password.name,
          { length: 30, special: false },
          { parent: this.baseResource }
        ).result;
        this.pendingPasswords.push([password.name, pass]);
        return pass;
      case 'external':
        return pulumi.Output.create<string>(password.password);
    }
  }

  public getResolvedPasswords(): pulumi.Output<Record<string, string>> {
    if (this.pendingPasswords.length <= 0)
      return pulumi.Output.create<Record<string, string>>({});

    return pulumi.all(this.pendingPasswords).apply((pendingPasswords) => {
      const res: Record<string, string> = {};
      for (const [name, pass] of pendingPasswords) res[name] = pass;
      return res;
    });
  }
}
