import { Base64 } from "js-base64";
import {
   gasPrices,
   cli,
   denomFee,
   denomStake,
   getBalance,
   memo,
   msig1,
   msig1SignTx,
   signAndBroadcastTx,
   signer,
   w1,
   w2,
   escrowModuleAddress,
   writeTmpJson,
   makeTx,
   fetchObject, urlRest
} from "./common";
import compareObjects from "./compareObjects";
import forge from "node-forge";

"use strict";


describe( "Tests the CLI.", () => {
   const validCertificate = `{"cert": {"certifier": {"id": "WeStart", "public_key": "b'344a77619d8d6a90d0fbc092880d89607117a9f6fee00ebbf7d3ffa47015fe01'", "URL": "https://www.westart.co/publickey"}, "entity": {"entity_type": "for profit", "registered_name": "IOV SAS", "registred_country": "FR", "VAT_number": "FR31813849017", "URL": "iov.one", "registration_date": "01/03/2018", "address": "55 rue la Boetie", "registered_city": "Paris"}, "starname": {"starname_owner_address": "hjkwbdkj", "starname": "*bestname"}}, "signature": "b'aeef538a01b2ca99a46cd119c9a33a3db1ed7aac15ae890dfe5e29efe329f9dfb7ce179fb4bd4b0ff7424a5981cb9f9408ebcbc8ea998d8478f9bc1276080e0a'"}`;
   const validator = cli( [ "query", "staking", "validators" ] ).validators.find( validator => !validator.jailed ).operator_address;


   it( `Should do a multisig delegate.`, async () => {
      let delegated0 = 0;
      try {
         const delegation = cli( [ "query", "staking", "delegation", msig1, validator ] );
         delegated0 = +delegation.balance.amount;
      } catch ( e ) {
         // no-op on no delegations yet
      }

      const amount = 1.25e6;
      const signed = msig1SignTx( [ "tx", "staking", "delegate", validator, `${amount}${denomStake}`, "--from", msig1, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const signedTmp = writeTmpJson( signed );

      const broadcasted = cli( [ "tx", "broadcast", signedTmp, "--broadcast-mode", "block", "--gas-prices", gasPrices ] );
      const delegated = cli( [ "query", "staking", "delegation", msig1, validator ] );

      expect( broadcasted.gas_used ).toBeDefined();
      expect( +delegated.balance.amount ).toEqual( delegated0 + amount );
   } );


   it( `Should do a multisig send.`, async () => {
      const amount = 1000000;
      const signed = msig1SignTx( [ "tx", "send", msig1, w1, `${amount}${denomFee}`, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const signedTmp = writeTmpJson( signed );

      const balance0 = cli( [ "query", "bank", "balances", w1 ] );
      const balance0Payer = cli( [ "query", "bank", "balances", msig1 ] );
      const broadcasted = cli( [ "tx", "broadcast", signedTmp, "--broadcast-mode", "block", "--gas-prices", gasPrices ] );
      const balance = cli( [ "query", "bank", "balances", w1 ] );
      const balancePayer = cli( [ "query", "bank", "balances", msig1 ] );

      expect( broadcasted.gas_used ).toBeDefined();
      expect( +getBalance( balance ) ).toEqual( amount + +getBalance( balance0 ) );
      expect( +getBalance( balancePayer ) ).toBeLessThan( +getBalance( balance0Payer ) - amount );
   } );


   it( `Should update fees.`, async () => {
      const fees0 = cli( [ "query", "configuration", "get-fees" ] );
      const fees = JSON.parse( JSON.stringify( fees0.fees ) );

      Object.keys( fees ).forEach( key => {
         if ( isFinite( parseFloat( fees[key] ) ) ) {
            fees[key] = String( 1.01 * fees[key] ).substring( 0, 17 ); // max precision is 18
         }
      } );

      const feesTmp = writeTmpJson( fees );
      const signed = msig1SignTx( [ "tx", "configuration", "update-fees", "--from", msig1, "--fees-file", feesTmp, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const signedTmp = writeTmpJson( signed );
      const broadcasted = cli( [ "tx", "broadcast", signedTmp, "--broadcast-mode", "block", "--gas-prices", gasPrices ] );
      const updated = cli( [ "query", "configuration", "get-fees" ] );
      const compare = ( had, got ) => {
         Object.keys( had ).forEach( key => {
            if ( isFinite( parseFloat( had[key] ) ) ) {
               expect( 1. * had[key] ).toEqual( 1. * got[key] );
            } else {
               expect( had[key] ).toEqual( got[key] );
            }
         } );
      };

      expect( broadcasted.gas_used ).toBeDefined();
      compare( fees, updated.fees );

      // restore original fees
      const fees0Tmp = writeTmpJson( fees0.fees );
      const signed0 = msig1SignTx( [ "tx", "configuration", "update-fees", "--from", msig1, "--fees-file", fees0Tmp, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const signed0Tmp = writeTmpJson( signed0 );
      const restore = cli( [ "tx", "broadcast", signed0Tmp, "--broadcast-mode", "block", "--gas-prices", gasPrices ] );
      const restored = cli( [ "query", "configuration", "get-fees" ] );

      expect( restore.gas_used ).toBeDefined();
      compare( fees0.fees, restored.fees );
   } );


   it( `Should verify the fidelity of a certificate.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const certificate0 = validCertificate;
      const base64 = Base64.encode( certificate0 );
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "domain-register", ...common ] ),
         cli( [ "tx", "starname", "account-register", "--name", name, ...common ] ),
         cli( [ "tx", "starname", "account-add-certificate", "--name", name, "--certificate", base64, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );
      const resolved = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.certificates[0] ).toEqual( base64 );
      expect( Base64.decode( resolved.account.certificates[0] ) ).toEqual( certificate0 );

      // verify signature
      const decoded = Base64.decode( resolved.account.certificates[0] );
      const message = decoded.match( /{"cert": (.*), "signature"/ )[1]; // fragile!
      const certificate = JSON.parse( decoded );
      const verified = forge.ed25519.verify( {
         message: message,
         encoding: "utf8",
         signature: forge.util.hexToBytes( certificate.signature.slice( 2, -1 ) ),
         publicKey: forge.util.hexToBytes( certificate.cert.certifier.public_key.slice( 2, -1 ) ),
      } );

      expect( verified ).toEqual( true );
   } )


   it( `Should puke on an invalid certificate.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const certificate0 = validCertificate;
      const invalidity = "scammer";
      const invalid = certificate0.replace( "hjkwbdkj", invalidity ); // invalidate the certificate
      const base64 = Base64.encode( invalid );
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "domain-register", ...common ] ),
         cli( [ "tx", "starname", "account-register", "--name", name, ...common ] ),
         cli( [ "tx", "starname", "account-add-certificate", "--name", name, "--certificate", base64, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );
      const resolved = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.certificates[0] ).toEqual( base64 );
      expect( Base64.decode( resolved.account.certificates[0] ) ).toEqual( invalid );

      // verify signature
      const decoded = Base64.decode( resolved.account.certificates[0] );
      const message = decoded.match( /{"cert": (.*), "signature"/ )[1]; // fragile!
      const certificate = JSON.parse( decoded );
      const verified = forge.ed25519.verify( {
         message: message,
         encoding: "utf8",
         signature: forge.util.hexToBytes( certificate.signature.slice( 2, -1 ) ),
         publicKey: forge.util.hexToBytes( certificate.cert.certifier.public_key.slice( 2, -1 ) ),
      } );

      expect( certificate.cert.starname.starname_owner_address ).toEqual( invalidity );
      expect( verified ).toEqual( false );
   } )


   it( `Should register a domain with a broker.`, async () => {
      const broker = w1;
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const registered = cli( [ "tx", "starname", "register-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--broker", broker, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( registered.txhash ).toBeDefined();
      if ( !registered.logs ) throw new Error( registered.raw_log );

      const domainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );

      expect( domainInfo.domain.name ).toEqual( domain );
      expect( domainInfo.domain.broker ).toEqual( broker );
   } );


   it( `Should register an account with a broker.`, async () => {
      const broker = w1;
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const registeredDomain = cli( [ "tx", "starname", "domain-register", "--yes", "--broadcast-mode", "block", "--domain", domain,                 "--broker", broker, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( registeredDomain.txhash ).toBeDefined();
      if ( !registeredDomain.logs ) throw new Error( registeredDomain.raw_log );

      const registered = cli( [ "tx", "starname", "account-register", "--yes", "--broadcast-mode", "block", "--domain", domain, "--name", name, "--broker", broker, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( registered.txhash ).toBeDefined();
      if ( !registered.logs ) throw new Error( registered.raw_log );

      const resolved = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.broker ).toEqual( broker );
   } );


   it( `Should do a multisig reward withdrawl.`, async () => {
      const signed = msig1SignTx( [ "tx", "distribution", "withdraw-rewards", validator, "--from", msig1, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const signedTmp = writeTmpJson( signed );

      const balance0 = cli( [ "query", "bank", "balances", msig1 ] );
      const broadcasted = cli( [ "tx", "broadcast", signedTmp, "--broadcast-mode", "block", "--gas-prices", gasPrices ] );
      const balance = cli( [ "query", "bank", "balances", msig1 ] );

      expect( broadcasted.gas_used ).toBeDefined();
      expect( +getBalance( balance ) + parseFloat( gasPrices ) * broadcasted.gas_wanted ).toBeGreaterThan( +getBalance( balance0 ) );
   } );


   it( `Should register a domain, register an account, transfer the domain with reset flag 0 (TransferFlush), and query domain-info.`, async () => {
      const transferFlag = "0";
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const metadata = "obviated by resource";
      const metadataEmpty = "top-level corporate info"; // metadata for the empty account
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "register-account",  "--name", name, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", name, "--metadata", metadata, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", "",   "--metadata", metadataEmpty, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved      = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      const resolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.metadata_uri ).toEqual( metadata );
      expect( resolvedEmpty.account.owner ).toEqual( signer );
      expect( resolvedEmpty.account.metadata_uri ).toEqual( metadataEmpty );

      const recipient = w1;
      const transferred = cli( [ "tx", "starname", "transfer-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--new-owner", recipient, "--transfer-flag", transferFlag, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( transferred.gas_used ).toBeDefined();
      if ( !transferred.logs ) throw new Error( transferred.raw_log );

      const newDomainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );
      const newResolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( newDomainInfo.domain.name ).toEqual( domain );
      expect( newDomainInfo.domain.admin ).toEqual( recipient );
      expect( newResolvedEmpty.account.owner ).toEqual( recipient );
      expect( newResolvedEmpty.account.metadata_uri ).toEqual( undefined );

      expect( () => {
         cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      } ).toThrow( `${name}*${domain}: account does not exist` );
   } );


   it( `Should register a domain, register an account, transfer the domain with reset flag 1 (TransferOwned), and query domain-info.`, async () => {
      const transferFlag = "1";
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const nameOther = `${Math.floor( Math.random() * 1e9 )}`;
      const other = w2; // 3rd party account owner in this case
      const metadata = "Why the uri suffix?";
      const metadataEmpty = "top-level corporate info"; // metadata for the empty account
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "register-account",  "--name", name, ...common ] ),
         cli( [ "tx", "starname", "register-account",  "--name", nameOther, "--owner", other, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", name, "--metadata", metadata, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", "",   "--metadata", metadataEmpty, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved      = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      const resolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );
      const resolvedOther = cli( [ "query", "starname", "resolve", "--starname", `${nameOther}*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.metadata_uri ).toEqual( metadata );
      expect( resolvedEmpty.account.owner ).toEqual( signer );
      expect( resolvedEmpty.account.metadata_uri ).toEqual( metadataEmpty );
      expect( resolvedOther.account.owner ).toEqual( other );

      const recipient = w1;
      const transferred = cli( [ "tx", "starname", "transfer-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--new-owner", recipient, "--transfer-flag", transferFlag, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( transferred.gas_used ).toBeDefined();
      if ( !transferred.logs ) throw new Error( transferred.raw_log );

      const newDomainInfo    = cli( [ "query", "starname", "domain-info", "--domain", domain ] );
      const newResolved      = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      const newResolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );
      const newResolvedOther = cli( [ "query", "starname", "resolve", "--starname", `${nameOther}*${domain}` ] );

      expect( newDomainInfo.domain.name ).toEqual( domain );
      expect( newDomainInfo.domain.admin ).toEqual( recipient );
      expect( newResolved.account.owner ).toEqual( recipient );
      expect( newResolved.account.metadata_uri ).toEqual( metadata );
      expect( newResolvedEmpty.account.owner ).toEqual( recipient );
      expect( newResolvedEmpty.account.metadata_uri ).toEqual( metadataEmpty );
      expect( newResolvedOther.account.owner ).toEqual( other );
   } );


   it( `Should register a domain, transfer it with reset flag 2 (ResetNone, the default), and query domain-info.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const nameOther = `${Math.floor( Math.random() * 1e9 )}`;
      const other = w2; // 3rd party account owner in this case
      const metadata = "Why the uri suffix?";
      const metadataEmpty = "top-level corporate info"; // metadata for the empty account
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "register-account",  "--name", name, ...common ] ),
         cli( [ "tx", "starname", "register-account",  "--name", nameOther, "--owner", other, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", name, "--metadata", metadata, ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", "",   "--metadata", metadataEmpty, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved      = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      const resolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );
      const resolvedOther = cli( [ "query", "starname", "resolve", "--starname", `${nameOther}*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.metadata_uri ).toEqual( metadata );
      expect( resolvedEmpty.account.owner ).toEqual( signer );
      expect( resolvedEmpty.account.metadata_uri ).toEqual( metadataEmpty );
      expect( resolvedOther.account.owner ).toEqual( other );

      const recipient = w1;
      const transferred = cli( [ "tx", "starname", "transfer-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--new-owner", recipient, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( transferred.gas_used ).toBeDefined();
      if ( !transferred.logs ) throw new Error( transferred.raw_log );

      const newDomainInfo    = cli( [ "query", "starname", "domain-info", "--domain", domain ] );
      const newResolved      = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );
      const newResolvedEmpty = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );
      const newResolvedOther = cli( [ "query", "starname", "resolve", "--starname", `${nameOther}*${domain}` ] );

      expect( newDomainInfo.domain.name ).toEqual( domain );
      expect( newDomainInfo.domain.admin ).toEqual( recipient );
      expect( newResolved.account.owner ).toEqual( signer );
      expect( newResolved.account.metadata_uri ).toEqual( metadata );
      expect( newResolvedEmpty.account.owner ).toEqual( recipient );
      expect( newResolvedEmpty.account.metadata_uri ).toEqual( metadataEmpty );
      expect( newResolvedOther.account.owner ).toEqual( other );
   } );


   it( `Should register an open domain and transfer it.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const registered = cli( [ "tx", "starname", "register-domain", "--yes", "--broadcast-mode", "block", "--type", "open", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( registered.txhash ).toBeDefined();
      if ( !registered.logs ) throw new Error( registered.raw_log );

      const domainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );

      expect( domainInfo.domain.name ).toEqual( domain );
      expect( domainInfo.domain.admin ).toEqual( signer );
      expect( domainInfo.domain.type ).toEqual( "open" );

      const recipient = w1;
      const transferred = cli( [ "tx", "starname", "transfer-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--new-owner", recipient, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( transferred.txhash ).toBeDefined();
      if ( !transferred.logs ) throw new Error( transferred.raw_log );

      const newDomainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );

      expect( newDomainInfo.domain.name ).toEqual( domain );
      expect( newDomainInfo.domain.admin ).toEqual( recipient );
      expect( newDomainInfo.domain.type ).toEqual( "open" );
   } );


   it( `Should register and renew a domain.`, async () => {
      // register domain
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const registered = cli( [ "tx", "starname", "register-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( registered.txhash ).toBeDefined();
      if ( !registered.logs ) throw new Error( registered.raw_log );

      // register account
      const notEmpty = cli( [ "tx", "starname", "register-account", "--yes", "--broadcast-mode", "block", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--name", "not-empty" ] );

      expect( notEmpty.txhash ).toBeDefined();
      if ( !notEmpty.logs ) throw new Error( notEmpty.raw_log );

      const domainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );

      expect( domainInfo.domain.name ).toEqual( domain );

      // renew
      const balance0 = cli( [ "query", "bank", "balances", signer ] );
      const renewed = cli( [ "tx", "starname", "renew-domain", "--yes", "--broadcast-mode", "block", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ] );

      expect( renewed.txhash ).toBeDefined();
      if ( !renewed.logs ) throw new Error( renewed.raw_log );

      const newDomainInfo = cli( [ "query", "starname", "domain-info", "--domain", domain ] );
      const starname = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );
      const balance = cli( [ "query", "bank", "balances", signer ] );
      const fees = cli( [ "query", "configuration", "get-fees" ] ).fees;
      const gasCost = parseFloat( gasPrices ) * renewed.gas_wanted;

      expect( newDomainInfo.domain.name ).toEqual( domain );
      expect( +newDomainInfo.domain.valid_until ).toBeGreaterThan( +domainInfo.domain.valid_until );
      expect( +newDomainInfo.domain.valid_until ).toEqual( +starname.account.valid_until );
      expect( +getBalance( balance ) ).toEqual( +getBalance( balance0 ) - ( +fees.register_domain_default + 2 * +fees.register_account_closed ) / fees.fee_coin_price - gasCost ); // 2 * due to "" and "non-empty" accounts
   } );


   it( `Should register and renew an account.`, async () => {
      // register
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = `${Math.floor( Math.random() * 1e9 )}`;
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "domain-register", "--generate-only", "--type", "open", ...common ] ),
         cli( [ "tx", "starname", "account-register", "--generate-only", "--name", name, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( name );

      // renew
      const renewed = cli( [ "tx", "starname", "renew-account", "--yes", "--broadcast-mode", "block", "--name", name, ...common ] );

      expect( renewed.txhash ).toBeDefined();
      if ( !renewed.logs ) throw new Error( renewed.raw_log );

      const newResolved = cli( [ "query", "starname", "resolve", "--starname", `${name}*${domain}` ] );

      expect( newResolved.account.domain ).toEqual( domain );
      expect( newResolved.account.name ).toEqual( name );
      expect( +newResolved.account.valid_until ).toBeGreaterThan( +resolved.account.valid_until );
   } );


   // TODO: don't skip when the message signing module is integrated
   it.skip( `Should sign a message, verify it, and fail verification after message alteration.`, async () => {
      const message = "Hello, World!";
      const created = cli( [ "tx", "signutil", "create", "--text", message, "--from", signer, "--memo", memo(), "--generate-only" ] );
      const tmpCreated = writeTmpJson( created );
      const signed = cli( [ "tx", "sign", tmpCreated, "--from", signer, "--offline", "--chain-id", "signed-message-v1", "--account-number", "0", "--sequence", "0" ] );
      const tmpSigned = writeTmpJson( signed );
      const verified = cli( [ "tx", "signutil", "verify", "--file", tmpSigned ] );

      expect( verified.message ).toEqual( message );
      expect( verified.signer ).toEqual( signer );

      // alter the y+NyzKwBpsPJ2xdZMYR4CkFMjhHh004gnRmyXqoWN9J7kqOHxNaevG7TMSvs/NnOT649kbxHUim7koWkvGy8Ew== signature
      signed.value.signatures[0].signature = "z" + signed.value.signatures[0].signature.substr( 1 );

      const tmpAltered = writeTmpJson( signed );

      try {
         cli( [ "tx", "signutil", "verify", "--file", tmpAltered ] );
      } catch ( e ) {
         expect( e.message.indexOf( "ERROR: invalid signature from address found at index 0" ) ).toEqual( 0 );
      }
   } );


   it( `Should do a reverse look-up.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const uri = "cosmos:iov-mainnet-2";
      const resource = "star1478t4fltj689nqu83vsmhz27quk7uggjwe96yk";
      const resources = [
         {
            "uri": uri,
            "resource": resource,
         }
      ];
      const fileResources = writeTmpJson( resources );
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "set-resources", "--name", "", "--src", fileResources, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const result = cli( [ "query", "starname", "resolve-resource", "--uri", uri, "--resource", resource ] );

      expect( result.accounts.length ).toBeGreaterThan( 0 );

      const account = result.accounts.find( a => a.domain == domain );

      expect( account ).toBeDefined();
      expect( account.domain ).toEqual( domain );
      expect( account.name ).toEqual( "" );
      expect( account.resources.find( r => r.uri == uri && r.resource == resource ) ).toBeDefined();
   } );


   it( `Should register a domain, set resources, and delete resources.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const resources = [
         {
            "uri": "cosmos:iov-mainnet-2",
            "resource": "star1478t4fltj689nqu83vsmhz27quk7uggjwe96yk"
         }
      ];
      const fileResources = writeTmpJson( resources );
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "set-resources", "--name", "", "--src", fileResources, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( "" );
      expect( resolved.account.owner ).toEqual( signer );
      compareObjects( resources, resolved.account.resources );

      const emptyResources = [];
      const tmpResources = writeTmpJson( emptyResources );
      const replaceResources1 = cli( [ "tx", "starname", "set-resources", "--domain", domain, "--name", "", "--src", tmpResources, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const broadcasted1 = signAndBroadcastTx( replaceResources1 );

      expect( broadcasted1.gas_used ).toBeDefined();
      if ( !broadcasted1.logs ) throw new Error( broadcasted.raw_log );

      const resolved1 = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( resolved1.account.hasOwnProperty( "resources" ) ).toBe( false );
   } );


   it( `Should register a domain, set metadata, and delete metadata.`, async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const metadata = "Not empty.";
      const common = [ "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ];
      const unsigned = makeTx(
         cli( [ "tx", "starname", "register-domain", ...common ] ),
         cli( [ "tx", "starname", "set-account-metadata", "--name", "", "--metadata", metadata, ...common ] ),
      );
      const broadcasted = signAndBroadcastTx( unsigned );

      expect( broadcasted.gas_used ).toBeDefined();
      if ( !broadcasted.logs ) throw new Error( broadcasted.raw_log );

      const resolved = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( resolved.account.domain ).toEqual( domain );
      expect( resolved.account.name ).toEqual( "" );
      expect( resolved.account.owner ).toEqual( signer );
      expect( resolved.account.metadata_uri ).toEqual( metadata );

      const metadata1 = "";
      const setMetadata1 = cli( [ "tx", "starname", "set-account-metadata", "--domain", domain, "--name", "", "--metadata", metadata1, "--from", signer, "--gas-prices", gasPrices, "--generate-only", "--memo", memo() ] );
      const broadcasted1 = signAndBroadcastTx( setMetadata1 );

      expect( broadcasted1.gas_used ).toBeDefined();
      if ( !broadcasted1.logs ) throw new Error( broadcasted.raw_log );

      const resolved1 = cli( [ "query", "starname", "resolve", "--starname", `*${domain}` ] );

      expect( resolved1.account.metadata_uri ).toEqual( undefined );
   } );


   it("Should create and transfer coins to an account escrow and a domain escrow", async () => {
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = "test";
      let unsigned = cli([ "tx", "starname", "register-domain", "--yes", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
      let broadcasted = signAndBroadcastTx( unsigned);
      expect( broadcasted.logs ).toBeDefined();

      //TODO: uncomment when account implements TransferableObject again
      /* unsigned = cli([ "tx", "starname", "register-account", "--yes", "--name", name, "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
       broadcasted = signAndBroadcastTx( unsigned);
       expect( broadcasted.logs ).toBeDefined();*/

      const price = "100" + denomFee;
      const expiration = new Date(Date.now() + 100000);
      let idDomainEscrow, idAccountEscrow;

      unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expiration.toISOString(), "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect(broadcasted.logs).toBeDefined()
      expect( idDomainEscrow = JSON.parse(broadcasted.logs[0].events[1].attributes.find(a => a.key === "id").value) ).toBeDefined();

      //TODO: uncomment when account implements TransferableObject again
      /* unsigned = cli(["tx", "starname", "create-account-escrow", "--yes", "--name", name, "--domain", domain, "--expiration", expiration.toISOString(), "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
       broadcasted = signAndBroadcastTx( unsigned );
       expect(broadcasted.logs).toBeDefined()
       expect( idAccountEscrow = JSON.parse(broadcasted.logs[0].events[1].attributes.find(a => a.key === "id").value) ).toBeDefined();
 */
      // Verify escrows exists
      let result = cli(["query", "escrow", "escrow", idDomainEscrow])
      expect(result.escrow).toBeDefined()
      expect(result.escrow.id).toEqual(idDomainEscrow)
      //TODO: uncomment when account implements TransferableObject again
/*
      result = cli(["query", "escrow", "escrow", idAccountEscrow])
      expect(result.escrow).toBeDefined()
      expect(result.escrow.id).toEqual(idAccountEscrow)*/
      // Verify domain belongs to module
      result = cli(["query", "starname", "resolve-domain", "--domain", domain])
      expect(result.domain).toBeDefined()
      expect(result.domain.admin).toEqual(escrowModuleAddress)
      //Verify account belongs to module
      //TODO: uncomment when account implements TransferableObject again
      /* result = cli(["query", "starname", "resolve-account", "--domain", domain, "--name", name])
       expect(result.account).toBeDefined()
       expect(result.account.owner).toEqual(escrowModuleAddress)*/

      // transfer domain
      unsigned = cli(["tx", "escrow", "transfer", idDomainEscrow, price, "--yes", "--from", w1, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned , "w1");
      expect(broadcasted.logs).toBeDefined()
      // Check escrow does not exist
      result = cli(["query", "escrow", "escrow", idDomainEscrow], true)
      expect(result.escrow).toBeUndefined()

      // Check domain belongs to buyer
      result = cli(["query", "starname", "resolve-domain", "--domain", domain])
      expect(result.domain).toBeDefined()
      expect(result.domain.admin).toEqual(w1)

      // transfer account
      //TODO: uncomment when account implements TransferableObject again
      /* unsigned = cli(["tx", "escrow", "transfer", idAccountEscrow, price, "--yes", "--from", w1, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
       broadcasted = signAndBroadcastTx( unsigned , "w1");
       expect(broadcasted.logs).toBeDefined()
      // Check escrow does not exist
      result = cli(["query", "escrow", "escrow", idAccountEscrow], true)
      expect(result.escrow).toBeUndefined()

      // Check account belongs to buyer
      result = cli(["query", "starname", "resolve-account", "--domain", domain, "--name", name])
      expect(result.domain).toBeDefined()
      expect(result.domain.owner).toEqual(w1)*/

   })
   it("Should update and refund an escrow", async () => {
      // Create domain
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = "test";
      let unsigned = cli([ "tx", "starname", "register-domain", "--yes", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
      let broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs ).toBeDefined();

      // Create escrow
      const price = "100" + denomFee;
      const expiration = new Date(Date.now() + 100000)
      let escrowId;
      unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expiration.toISOString(), "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( escrowId = JSON.parse(broadcasted.logs[0].events[1].attributes.find(a => a.key === "id").value) ).toBeDefined();

      // Modify deadline and price
      const modifiedPrice = "120" + denomFee;
      const modifiedExpiration = new Date(expiration.valueOf() + 5000000)
      unsigned = cli(["tx", "escrow", "update", "--yes", escrowId, "--expiration", modifiedExpiration.toISOString(), "--price", modifiedPrice, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs  ).toBeDefined();

      // Check data
      let result = cli(["query", "escrow", "escrow", escrowId])
      expect(result.escrow).toBeDefined()
      expect(result.escrow.id).toEqual(escrowId)
      expect(result.escrow.price[0].amount + result.escrow.price[0].denom).toEqual(modifiedPrice)
      expect(JSON.parse(result.escrow.deadline)).toEqual(parseInt(modifiedExpiration.valueOf() / 1000))
      // Check belongs to module
      result = cli(["query", "starname", "resolve-domain", "--domain", domain])
      expect(result.domain).toBeDefined()
      expect(result.domain.admin).toEqual(escrowModuleAddress)

      // Refund
      unsigned = cli(["tx", "escrow", "refund", escrowId, "--yes","--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs ).toBeDefined();

      // Check escrow does not exist
      result = cli(["query", "escrow", "escrow", escrowId], true)
      expect(result.escrow).toBeUndefined()

      // Check account belongs to user
      result = cli(["query", "starname", "resolve-domain", "--domain", domain])
      expect(result.domain).toBeDefined()
      expect(result.domain.admin).toEqual(signer)
   })
   it("Should limit the escrow deadline", async () => {
      // Create domain
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = "test";
      let unsigned = cli([ "tx", "starname", "register-domain", "--yes", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
      let broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs ).toBeDefined();


      // Create escrow too far away
      const price = "100" + denomFee;
      const expirationTooFar = "5025-01-01T00:00:00Z";
      let escrowId;
      unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expirationTooFar, "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"], true)
      expect( unsigned.length).toBe(0);


      // check escrow does not exist
      let result = cli(["query", "escrow", "escrows", "--object", Buffer.from(domain + "*" + name).toString('hex')])
      expect(result.escrows).toBeUndefined();

      // Create escrow
      let expiration = new Date(Date.now() + 1000000)
      unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expiration.toISOString(), "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( escrowId = JSON.parse(broadcasted.logs[0].events[1].attributes.find(a => a.key === "id").value) ).toBeDefined();

      // check does exist
      result = cli(["query", "escrow", "escrow", escrowId])
      expect(result.escrow).toBeDefined()
      expect(result.escrow.id).toEqual(escrowId)

      // Modify deadline after max period
      unsigned = cli(["tx", "escrow", "update", "--yes", "--expiration", expirationTooFar, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"], true)
      expect( unsigned.length ).toBe(0);
      // check data
      result = cli(["query", "escrow", "escrow", escrowId])
      expect(result.escrow).toBeDefined()
      expect(JSON.parse(result.escrow.deadline)).toEqual(parseInt(expiration.valueOf() / 1000))

   })
   it("Should not allow account registration while a domain is in an escrow", async () => {
      // Create domain
      const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
      const name = "test";
      let unsigned = cli([ "tx", "starname", "register-domain", "--yes", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
      let broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs ).toBeDefined();

      // Create escrow
      const price = "100" + denomFee;
      const expiration = new Date(Date.now() + 100000);
      let escrowId;
      unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expiration.toISOString(), "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( escrowId = JSON.parse(broadcasted.logs[0].events[1].attributes.find(a => a.key === "id").value) ).toBeDefined();

      //Check escrow exists
      let result = cli(["query", "escrow", "escrow", escrowId])
      expect(result.escrow).toBeDefined()
      expect(result.escrow.id).toEqual(escrowId)

      // Create account
      unsigned = cli([ "tx", "starname", "register-account", "--yes", "--name", name, "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
      broadcasted = signAndBroadcastTx( unsigned );
      expect( broadcasted.logs ).toBeUndefined();

      //Check account does not exist
      result = cli(["query", "starname", "resolve-account", "--domain", domain, "--name", name], true);
      expect(result.account).toBeUndefined();
   })
   it("Should not allow escrow creation if the account/domain expiration date is less that the escrow expiration date",
       async () => {
          const domain = `domain${Math.floor( Math.random() * 1e9 )}`;
          const name = "test";
          // Create domain
          let unsigned = cli([ "tx", "starname", "register-domain", "--yes", "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
          let broadcasted = signAndBroadcastTx( unsigned );
          expect( broadcasted.logs ).toBeDefined();

          // Create account
          unsigned = cli([ "tx", "starname", "register-account", "--yes", "--name", name, "--domain", domain, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only" ])
          broadcasted = signAndBroadcastTx( unsigned );
          expect( broadcasted.logs ).toBeDefined();

          // Get account and domain expiration date
          let result  = cli(["query", "starname", "resolve-domain", "--domain", domain])
          expect(result.domain.valid_until).toBeDefined()
          let domainExpiration = result.domain.valid_until

          result  = cli(["query", "starname", "resolve-account", "--domain", domain, "--name", name])
          expect(result.account.valid_until).toBeDefined()
          let accountExpiration = result.account.valid_until

          //Create escrow domain / account with long expiration date
          const price = "100" + denomFee;
          let expirationTooFar = new Date((domainExpiration + 10) * 1000).toISOString()
          unsigned = cli(["tx", "starname", "create-domain-escrow", "--yes", "--domain", domain, "--expiration", expirationTooFar, "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"], true)
          expect( unsigned.length).toBe(0);

          //TODO: uncomment when account implements TransferableObject again
       /*
        expirationTooFar = new Date((accountExpiration + 10) * 1000).toISOString()
          unsigned = cli(["tx", "starname", "create-account-escrow", "--yes", "--name", name, "--domain", domain, "--expiration", expirationTooFar, "--price", price, "--from", signer, "--gas-prices", gasPrices, "--memo", memo(), "--generate-only"], true)
          expect( unsigned.length).toBe(0);*/

          // Check does not exist
          result = cli([ "query", "escrow", "escrows", "--seller", signer, "--state", "open" ])
          expect(result.escrows).toBeDefined()
          expect(result.escrows.find(e => e.object.domain === domain || e.object.name == domain)).toBeUndefined()

       })
   it("Should reject the creation of an escrow with a closed-domain account ", async () => {
      //TODO
   })

} );
