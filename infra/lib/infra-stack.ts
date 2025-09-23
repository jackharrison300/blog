import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

interface StaticSiteStackProps extends cdk.StackProps {
  domainName: string;      // e.g., example.com
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    
    const domainName = props.domainName;
    const wwwDomain = `www.${domainName}`;
    
    // Look up the hosted zone
    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: domainName
    });

    // Create the main S3 bucket for the root domain
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    // Create redirect bucket for the www subdomain
    const wwwRedirectBucket = new s3.Bucket(this, 'WwwRedirectBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      websiteRedirect: {
        hostName: domainName,
        protocol: s3.RedirectProtocol.HTTPS
      }
    });
    
    // Create certificates for both domains
    const siteCertificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName: domainName,
      subjectAlternativeNames: [wwwDomain],
      hostedZone: zone,
      region: 'us-east-1', // CloudFront requires certificates in us-east-1
    });
    
    // Create a CloudFront function to append .html to URLs without extensions
    const appendHtmlFunction = new cloudfront.Function(this, 'AppendHtmlFunction', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          
          // Don't modify requests that already have file extensions or end with a slash
          if (uri.includes('.') || uri.endsWith('/')) {
            return request;
          }
          
          // Don't modify if it's trying to access a specific file in a folder
          if (uri.split('/').length > 2 && !uri.endsWith('/')) {
            return request;
          }
          
          // Append .html to the URI
          request.uri = uri + '.html';
          
          return request;
        }
      `),
      comment: 'Append .html extension to URLs without extensions'
    });
    
    // Create a CloudFront distribution for the main site at the root domain
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: appendHtmlFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
          }
        ]
      },
      domainNames: [domainName],
      certificate: siteCertificate,
      defaultRootObject: 'index.html',
      // Add error handling for SPA routes
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    // Create a CloudFront distribution for the www subdomain that will redirect to root
    const wwwRedirectDistribution = new cloudfront.Distribution(this, 'WwwRedirectDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(wwwRedirectBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [wwwDomain],
      certificate: siteCertificate,
    });

    // Deploy the contents of the 'out' folder to the main S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('../out')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*']
    });
    
    // Create Route53 records for both domains
    new route53.ARecord(this, 'RootAliasRecord', {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      zone
    });
    
    new route53.ARecord(this, 'WwwAliasRecord', {
      recordName: wwwDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(wwwRedirectDistribution)),
      zone
    });
    
    // Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'The domain name of the main CloudFront distribution'
    });
    
    new cdk.CfnOutput(this, 'WwwRedirectDistributionDomainName', {
      value: wwwRedirectDistribution.distributionDomainName,
      description: 'The domain name of the www redirect CloudFront distribution'
    });
    
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${domainName}`,
      description: 'The URL of the website'
    });
  }
}
