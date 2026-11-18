// F69: the local install profile (LocalCA.mobileconfig), signed with the user's own certificate so iOS shows it as
// Verified with their name instead of Unsigned. A configuration profile is signed as an attached CMS SignedData: the
// plist itself is the encapsulated content (id-data), signed by the leaf with its issuers (Apple's WWDR CA and root
// on the phone) in the certificate set so iOS can build the chain. With no certificate imported yet the profile stays
// unsigned. Format: RFC 5652 (signed attributes content type, signing time, message digest), as `openssl cms -sign
// -nodetach -binary` writes it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum ProfileSign {
    // `content` (the .mobileconfig plist) inside a CMS SignedData by `id`, DER.
    static func sign(_ content: Data, id: SigningIdentity, time: Date = Date()) throws -> Data {
        let dataOID = "1.2.840.113549.1.7.1"
        func attr(_ oid: String, _ value: Data) -> Data { DER.seq([DER.oid(oid), DER.set([value])]) }
        let signedSet = DER.setOf([
            attr("1.2.840.113549.1.9.3", DER.oid(dataOID)),                  // content type: data
            attr("1.2.840.113549.1.9.5", DER.time(time)),                    // signing time
            attr("1.2.840.113549.1.9.4", DER.octets(sha256(content))),       // message digest
        ])
        let signature = try id.sign(signedSet)
        let leaf = try Certificate(der: id.certificate)
        var implicitAttrs = signedSet
        implicitAttrs[implicitAttrs.startIndex] = 0xA0 // [0] IMPLICIT, as the signature covers the SET form
        let sigAlg = id.signatureAlgorithm == "1.2.840.113549.1.1.1"
            ? DER.seq([DER.oid(id.signatureAlgorithm), DER.null]) : DER.seq([DER.oid(id.signatureAlgorithm)])
        let signerInfo = DER.seq([
            DER.int(1),
            DER.seq([leaf.issuer, leaf.serial]),
            DER.seq([DER.oid(CMS.sha256OID), DER.null]),
            implicitAttrs,
            sigAlg,
            DER.octets(signature),
        ])
        let certs = ([id.certificate] + id.chain).reduce(Data(), +)
        let signedData = DER.seq([
            DER.int(1),
            DER.set([DER.seq([DER.oid(CMS.sha256OID), DER.null])]),
            DER.seq([DER.oid(dataOID), DER.explicit(0, DER.octets(content))]), // the profile, attached
            DER.implicitCons(0, certs),
            DER.set([signerInfo]),
        ])
        return DER.seq([DER.oid("1.2.840.113549.1.7.2"), DER.explicit(0, signedData)])
    }

    // The profile to serve: signed by `id` when there is one, else the plain plist. `signed` says which; a signing
    // failure (the Keychain refusing the key) falls back to unsigned rather than leaving the user without a profile.
    static func profile(_ plist: Data, id: SigningIdentity?) -> (data: Data, signed: Bool) {
        guard let id = id, let cms = try? sign(plist, id: id) else { return (plist, false) }
        return (cms, true)
    }
}
