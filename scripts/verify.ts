import { run } from "hardhat";
import { ContractFactory } from "ethers";

export async function verify(address: string, constructorArguments: any[] = []) {
    console.log("Verifying contract...");
    try {
        await run("verify:verify", {
            address: address,
            constructorArguments: constructorArguments,
        });
        console.log("Contract verified successfully");
    } catch (e: any) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("Contract is already verified!");
        } else {
            console.log("Error verifying contract: ", e);
        }
    }
}

// Helper function to get encoded constructor arguments
export function getEncodedParams(factory: ContractFactory, params: any[]) {
    return factory.interface.encodeDeploy(params);
}