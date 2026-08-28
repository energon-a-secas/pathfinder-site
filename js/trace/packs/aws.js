// ════════════════════════════════════════════════════════════
//  trace/packs/aws.js: AWS connectivity knowledge, as data
//
//  Seeded from the cross-account reachability cases that come up most.
//  Every entry names something to run. Where a claim is a real AWS
//  constraint rather than a preference, it says so in `why`, because the
//  difference decides whether you argue with it.
//
//  Extend this file as real cases land. A rule that never fired on a real
//  incident is a rule nobody has checked.
// ════════════════════════════════════════════════════════════

export const AWS_PACK = {
  id: 'aws',
  label: 'AWS connectivity',
  rules: [

    {
      id: 'reachability-analyzer',
      weight: 95,
      when: ctx => ctx.isTopology && (ctx.brokenCrossAccount.length > 0 || ctx.crossAccount.length > 0),
      title: 'Run Reachability Analyzer before reading any config',
      body: 'It walks the actual path and names the exact hop that blocks it: route table, security group, or NACL. It answers in a minute what reading consoles takes an afternoon to guess at.',
      why: 'Static analysis of the real network state, so it does not need the service to be running or the packet to be sent.',
      probes: [
        'aws ec2 create-network-insights-path --source i-SOURCE --destination i-DEST --protocol tcp --destination-port 443',
        'aws ec2 start-network-insights-analysis --network-insights-path-id nip-EXAMPLE',
        'aws ec2 describe-network-insights-analyses --network-insights-analysis-ids nia-EXAMPLE --query "NetworkInsightsAnalyses[].{Reachable:NetworkPathFound,Blocker:ForwardPathComponents[-1]}"',
      ],
    },

    {
      id: 'try-the-ip',
      weight: 90,
      when: ctx => ctx.says('dns', 'resolve', 'hosted zone', 'nxdomain', 'route 53', 'r53'),
      title: 'Try the IP directly, to take DNS out of the question',
      body: 'If the IP works and the name does not, it is DNS and nothing else. If neither works, DNS was never the problem and you have saved yourself the Route 53 console.',
      why: 'One command splits the whole search space in half.',
      probes: [
        'dig +short svc.internal.example.com',
        'curl -sv --max-time 10 --resolve svc.internal.example.com:443:10.20.30.40 https://svc.internal.example.com/health',
        'nc -vz -w 5 10.20.30.40 443',
      ],
    },

    {
      id: 'resolve-from-inside',
      weight: 88,
      when: ctx => ctx.says('dns', 'resolve', 'nxdomain', 'hosted zone'),
      title: 'Resolve from inside the VPC, not from your laptop',
      body: 'A private hosted zone answers only inside the VPCs it is associated with. Your laptop asks public DNS and gets a confident, useless answer.',
      why: 'The single most common false negative in this whole class of problem.',
      probes: [
        'aws ssm start-session --target i-EXAMPLE',
        'dig +short svc.internal.example.com @169.254.169.253',
      ],
    },

    {
      id: 'no-shell-fallbacks',
      weight: 80,
      when: ctx => ctx.says('ssh', 'cannot connect', 'unreachable', 'timeout', 'times out', 'no route'),
      title: 'If you cannot get a shell, you still have three ways in',
      body: 'Session Manager needs no inbound rule and no public address. EC2 Instance Connect Endpoint works inside a private subnet. The serial console works when the network stack itself is the thing that is broken.',
      why: 'Losing SSH is usually taken as proof the host is gone, and it is usually just the network path.',
      probes: [
        'aws ssm start-session --target i-EXAMPLE',
        'aws ec2-instance-connect ssh --instance-id i-EXAMPLE --connection-type eice',
        'aws ec2 send-serial-console-ssh-public-key --instance-id i-EXAMPLE --serial-port 0 --ssh-public-key file://key.pub',
      ],
    },

    {
      id: 'cross-account-options',
      weight: 78,
      when: ctx => ctx.isTopology && ctx.crossAccount.length > 0,
      title: 'Three ways to connect two accounts, and only one tolerates overlapping CIDRs',
      body: 'PrivateLink exposes one service through an endpoint and creates no routing relationship, so the address spaces never have to agree. Peering is cheapest but does not transit, so it does not scale past a handful. Transit Gateway is the right answer once there are many VPCs, and it needs distinct CIDRs like peering does.',
      why: 'A real AWS constraint, not a preference: peering and TGW both join address spaces and cannot disambiguate a duplicate range.',
      probes: [
        'aws ec2 describe-vpcs --query "Vpcs[].{Id:VpcId,Cidr:CidrBlock}" --output table',
        'aws ec2 describe-transit-gateway-attachments --query "TransitGatewayAttachments[].{Id:TransitGatewayAttachmentId,Res:ResourceId,State:State}"',
      ],
    },

    {
      id: 'return-path',
      weight: 72,
      when: ctx => ctx.says('security group', 'nacl', 'network acl', 'firewall', 'timeout', 'times out'),
      title: 'Check the return path, not just the outbound one',
      body: 'Security groups are stateful, so the reply is allowed automatically. NACLs are not. A NACL that permits inbound 443 but not the ephemeral return range produces a clean timeout that looks exactly like a missing route.',
      why: 'The stateless half is the one people forget, because the stateful half trained them not to think about it.',
      probes: [
        'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-EXAMPLE --query "NetworkAcls[].Entries"',
        'aws ec2 describe-security-groups --group-ids sg-DESTINATION --query "SecurityGroups[].IpPermissions"',
      ],
    },

    {
      id: 'sg-reference-limit',
      weight: 68,
      when: ctx => ctx.says('transit gateway', 'tgw') && ctx.says('security group', 'sg-'),
      title: 'A security group cannot reference another one across a Transit Gateway',
      body: 'Referencing a security group by id across accounts works over peering, or inside a shared VPC. Across a TGW it does not, and you have to use the CIDR instead.',
      why: 'A hard limitation. Worth knowing before you spend an hour on a rule that cannot work.',
      probes: ['aws ec2 describe-security-groups --group-ids sg-DESTINATION --query "SecurityGroups[].IpPermissions[].UserIdGroupPairs"'],
    },

    {
      id: 'flow-logs',
      weight: 60,
      when: ctx => ctx.says('timeout', 'times out', 'drop', 'no response', 'hangs'),
      title: 'Flow logs settle whether the packets ever arrive',
      body: 'REJECT means something dropped them at the destination. No record at all means they never got there, which points at routing rather than filtering.',
      why: 'Turns an argument about whose side is broken into a fact.',
      probes: ['fields @timestamp, srcAddr, dstAddr, dstPort, action | filter dstAddr = "10.20.30.40" | sort @timestamp desc | limit 50'],
    },

    {
      id: 'endpoint-sg',
      weight: 58,
      when: ctx => ctx.says('vpc endpoint', 'privatelink', 'vpce', 'interface endpoint'),
      title: 'An interface endpoint has its own security group',
      body: 'It is an ENI in your subnet, with a group separate from the service\'s, and it defaults to allowing nothing useful.',
      probes: ['aws ec2 describe-vpc-endpoints --vpc-endpoint-ids vpce-EXAMPLE --query "VpcEndpoints[].{Groups:Groups,PrivateDns:PrivateDnsEnabled,State:State}"'],
    },

    {
      id: 'zone-association-handshake',
      weight: 56,
      when: ctx => ctx.says('hosted zone', 'private zone', 'route 53', 'r53'),
      title: 'Cross-account zone association is two calls from two accounts',
      body: 'The zone owner authorises, then the VPC owner associates. Running only the first leaves a state that looks configured and resolves nothing.',
      probes: [
        'aws route53 list-hosted-zones-by-vpc --vpc-id vpc-EXAMPLE --vpc-region us-east-1',
        'aws route53 create-vpc-association-authorization --hosted-zone-id Z123 --vpc VPCRegion=us-east-1,VPCId=vpc-EXAMPLE',
        'aws route53 associate-vpc-with-hosted-zone --hosted-zone-id Z123 --vpc VPCRegion=us-east-1,VPCId=vpc-EXAMPLE',
      ],
    },

    {
      id: 'is-it-even-network',
      weight: 54,
      when: ctx => ctx.says('403', 'accessdenied', 'access denied', 'forbidden', 'unauthorized'),
      title: 'A 403 is not a network problem',
      body: 'The request arrived, was understood, and was refused. Stop looking at routes and read the resource policy, the role trust policy, and who the caller actually is.',
      probes: ['aws sts get-caller-identity', 'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::111122223333:role/EXAMPLE --action-names s3:GetObject'],
    },

    {
      id: 'unverified-hops',
      weight: 45,
      when: ctx => ctx.isTopology && ctx.trace.edges.filter(e => e.state === 'unknown').length >= 3,
      title: ctx => 'Most of this map is unverified',
      body: ctx => `${ctx.trace.edges.filter(e => e.state === 'unknown').length} of ${ctx.trace.edges.length} hops carry no state. Mark each one ok or broken as you check it, and the map stops being a drawing of what you assume.`,
      why: 'The point of the state field. A map where everything is unverified is a picture, not evidence.',
    },

    {
      id: 'checks-without-probes',
      weight: 40,
      when: ctx => ctx.isTree && ctx.trace.nodes.filter(n => n.kind === 'check' && !n.probes.length).length >= 2,
      title: ctx => `${ctx.trace.nodes.filter(n => n.kind === 'check' && !n.probes.length).length} checks have no command attached`,
      body: ctx => 'Give each one a `probe:`. A check somebody cannot run is a check they will guess at: '
        + ctx.trace.nodes.filter(n => n.kind === 'check' && !n.probes.length).slice(0, 4).map(n => n.id).join(', ') + '.',
      why: 'The difference between a runbook and a diagram of one.',
    },
  ],
}
