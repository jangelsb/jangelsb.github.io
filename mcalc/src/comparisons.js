export const CREATE_NEW_COMPARISON = '__new__';

export function buildComparisonHomeConfigs(homes, compareScenarioIds, compareHomeIds) {
    return homes.map(home => ({
        homeId: home.id,
        scenarioId: compareScenarioIds[home.id] || home.scenarios[0]?.id || null,
        isIncluded: compareHomeIds[home.id] !== false
    }));
}

export function applyComparisonHomeConfigs(configs = []) {
    const compareHomeIds = {};
    const compareScenarioIds = {};
    configs.forEach(config => {
        compareHomeIds[config.homeId] = config.isIncluded;
        compareScenarioIds[config.homeId] = config.scenarioId;
    });
    return { compareHomeIds, compareScenarioIds };
}
